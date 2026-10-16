// Turns what upstream's CodeGeneratorJS.pm prints for an interface into the JS<Interface>.{h,cpp} that Bun compiles.
//
// In this order, for each file:
//   1. `#include <WebCore/X.h>` becomes `#include "X.h"`.
//   2. The rules for every file (bindings-rules.ts).
//   3. Runtime-enabled members. The generator deletes them from the prototype in finishCreation() when their condition is false.
//      Bun knows the answer now: either the test goes, or the member does.
//   4. The members, setters, DOMJIT records and enumerations that bindings-rules.ts lists go.
//   5. Code that the generator repeats in every accessor or class moves into shared functions.
//   6. The rules for this one file.
//   7. `#include` of a header that Bun does not have goes.
import {
  hotReflectedAttributes,
  notActiveDOMObjects,
  otherConditions,
  readonlyAttributes,
  removedEnumerations,
  removedMembers,
  rulesForEveryFile,
  rulesForOneFile,
  settings,
  withoutDOMJIT,
} from "./bindings-rules.ts";
import { dropUnknownIncludes, escapeRegExp, groupsOf, replaceAndCount, useQuotedIncludes } from "./util.ts";

const raw = String.raw;

/** What the generator printed for one interface, and what Bun compiles. */
export interface Binding {
  header: string;
  implementation: string;
}

const CONTEXT = raw`(?:downcast<Document>\()?uncheckedDowncast<JSDOMGlobalObject>\(realm\(\)\)->scriptExecutionContext\(\)\)?`;

/** The value of the C++ condition of a runtime-enabled member. */
function evaluate(condition: string): boolean {
  let expression = condition.replace(new RegExp(CONTEXT + raw`->settingsValues\(\)\.(\w+)`, "g"), (_, name) => {
    if (!(name in settings)) throw new Error(`no value for ${name} in \`settings\` (bindings-rules.ts)`);
    return String(settings[name]);
  });
  expression = expression.replace(new RegExp(CONTEXT + raw`->quirks\(\)\.\w+\(\)`, "g"), "false");
  for (const [pattern, value] of otherConditions)
    expression = expression.replace(new RegExp(pattern.replace("CTX", CONTEXT), "g"), String(value));

  const tokens = expression.match(/true|false|\|\||&&|!|\(|\)|\S+/g) ?? [];
  let position = 0;
  const or = (): boolean => {
    let value = and();
    while (tokens[position] === "||") {
      position++;
      const right = and();
      value = value || right;
    }
    return value;
  };
  const and = (): boolean => {
    let value = not();
    while (tokens[position] === "&&") {
      position++;
      const right = not();
      value = value && right;
    }
    return value;
  };
  const not = (): boolean => {
    const token = tokens[position++];
    if (token === "!") return !not();
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "(") {
      const value = or();
      if (tokens[position++] === ")") return value;
    }
    throw new Error(`cannot evaluate: ${condition}`);
  };
  const value = or();
  if (position !== tokens.length) throw new Error(`cannot evaluate: ${condition}`);
  return value;
}

const RUNTIME_ENABLED_MEMBER = new RegExp(
  raw`((?:#if [^\n]*\n)?)    if \(!(.*)\) \{
        hasDisabledRuntimeProperties = true;
        auto propertyName = Identifier::fromString\(vm, "(\w+)"_s\);
        VM::DeletePropertyModeScope scope\(vm, VM::DeletePropertyMode::IgnoreConfigurable\);
        DeletePropertySlot slot;
        JSObject::deleteProperty\(this, realm\(\), propertyName, slot\);
    \}
((?:#endif\n)?)`,
  "g",
);

// A dictionary member with [EnabledBySetting] or [EnabledForWorld].
const CONDITIONAL_DICTIONARY_MEMBER = new RegExp(
  raw`    auto (\w+) = \[&\] -> (ConversionResult<.*>) \{
        if \((.*)\) \{
((?:            [^\n]*\n)+)        \} else \{
            return ([^\n]*);
        \}
    \}\(\);
`,
  "g",
);

function conditionalDictionaryMember(
  _: string,
  name: string,
  type: string,
  condition: string,
  body: string,
  otherwise: string,
): string {
  const inPrototypeTerms = condition
    .replaceAll(
      "uncheckedDowncast<JSDOMGlobalObject>(&lexicalGlobalObject)",
      "uncheckedDowncast<JSDOMGlobalObject>(realm())",
    )
    .replaceAll("worldForDOMObject(*&lexicalGlobalObject)", "worldForDOMObject(*realm())");
  if (!evaluate(inPrototypeTerms)) return `    auto ${name} = ${otherwise};\n`;
  return `    auto ${name} = [&] -> ${type} {\n${body.replace(/^    /gm, "")}    }();\n`;
}

/** Removes every top-level definition whose first line matches `firstLine`, up to the `}` in column 0 and the blank line after it. */
function removeDefinitions(text: string, firstLine: RegExp): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (!firstLine.test(lines[i])) {
      kept.push(lines[i++]);
      continue;
    }
    while (lines[i] !== "}" && !lines[i].startsWith("};")) i++;
    i++;
    if (i < lines.length && lines[i] === "") i++;
  }
  return kept.join("\n");
}

const capitalized = (name: string) => name[0].toUpperCase() + name.slice(1);

function removeMember(text: string, I: string, name: string): string {
  const n = escapeRegExp(name);
  const upper = capitalized(name);
  const stem = raw`(?:set)?[jJ][sS]${I}(?:PrototypeFunction|ConstructorFunction|InstanceFunction)?_${n}`;
  // declarations
  text = text.replace(new RegExp(raw`^static JSC_DECLARE_\w+\(${stem}(?:WithoutTypeCheck)?[,)][^\n]*\n`, "gm"), "");
  // definitions
  text = removeDefinitions(
    text,
    new RegExp(
      raw`^(?:static inline [\w:]+ |JSC_DEFINE_\w+\()(?:[\w:]+, )?${stem}(?:\d*Body|Getter|Setter|OverloadDispatcher|WithoutTypeCheck)?[,(]`,
    ),
  );
  // DOMJIT records
  text = removeDefinitions(
    text,
    new RegExp(raw`^static const JSC::DOMJIT::GetterSetter DOMJITAttributeFor${I}${upper} \{`),
  );
  text = text.replace(
    new RegExp(raw`^static const JSC::DOMJIT::Signature DOMJITSignatureFor${I}${upper}\((?:[^;]|\n)*?\);\n\n?`, "gm"),
    "",
  );
  text = text.replace(
    new RegExp(
      raw`#if ENABLE\(JIT\)\nRef<JSC::DOMJIT::CallDOMGetterSnippet> compile${I}${upper}Attribute\(\);\n#endif\n\n?`,
      "g",
    ),
    "",
  );
  // table rows, with the size of the table they are in
  const row = new RegExp(
    raw`^(?:#if [^\n]*\n)?    HashTableValue \{ "${n}"_s, [^\n]*\},\n(?:#else\n    HashTableValue \{ \{ \}, 0, NoIntrinsic, \{ HashTableValue::End \} \},\n#endif\n)?`,
    "gm",
  );
  text = text.replace(
    new RegExp(
      raw`(static const std::array<HashTableValue, )(\d+)(> JS${I}(?:Prototype|Constructor|)TableValues \{\n(?:[^\n]*\n)*?\};\n)`,
      "g",
    ),
    (_, before, size, rest) => {
      const [body, count] = replaceAndCount(rest, row, "");
      return `${before}${Number(size) - count}${body}`;
    },
  );
  // unscopables
  text = text.replace(
    new RegExp(
      raw`^    unscopables\.putDirect\(vm, Identifier::fromString\(vm, "${n}"_s\), jsBoolean\(true\)\);\n`,
      "gm",
    ),
    "",
  );
  // custom members declared in the header
  return text.replace(
    new RegExp(
      raw`^    (?:JSC::JSValue|void) (?:${n}|set${upper})\(JSC::JSGlobalObject&(?:, JSC::CallFrame&|, JSC::JSValue)?\)(?: const)?;\n`,
      "gm",
    ),
    "",
  );
}

function makeReadonly(text: string, I: string, name: string): string {
  const n = escapeRegExp(name);
  text = text.replace(new RegExp(raw`^static JSC_DECLARE_CUSTOM_SETTER\(setJS${I}_${n}\);\n`, "gm"), "");
  text = removeDefinitions(
    text,
    new RegExp(raw`^(?:static inline bool |JSC_DEFINE_CUSTOM_SETTER\()setJS${I}_${n}(?:Setter)?[,(]`),
  );
  return text.replace(
    new RegExp(
      raw`(HashTableValue \{ "${n}"_s, )(JSC::PropertyAttribute::CustomAccessor[^,]*, NoIntrinsic, \{ HashTableValue::GetterSetterType, js${I}_${n}, )setJS${I}_${n} \}`,
      "g",
    ),
    "$1JSC::PropertyAttribute::ReadOnly | $20 }",
  );
}

function removeDOMJIT(text: string, I: string, name: string): string {
  const n = escapeRegExp(name);
  const upper = capitalized(name);
  text = removeDefinitions(
    text,
    new RegExp(raw`^static const JSC::DOMJIT::GetterSetter DOMJITAttributeFor${I}${upper} \{`),
  );
  text = text.replace(
    new RegExp(
      raw`#if ENABLE\(JIT\)\nRef<JSC::DOMJIT::CallDOMGetterSnippet> compile${I}${upper}Attribute\(\);\n#endif\n\n?`,
      "g",
    ),
    "",
  );
  return text.replace(
    new RegExp(
      raw`(HashTableValue \{ "${n}"_s, [^,]*)JSC::PropertyAttribute::DOMJITAttribute(, NoIntrinsic, \{ )HashTableValue::DOMJITAttributeType, &DOMJITAttributeFor${I}${upper}, `,
      "g",
    ),
    `$1JSC::PropertyAttribute::DOMAttribute$2HashTableValue::GetterSetterType, js${I}_${name}, `,
  );
}

function removeActiveDOMObject(text: string, I: string): string {
  text = text.replace(
    new RegExp(raw`class WEBCORE_EXPORT JS${I}Owner final : public JSNodeOwner \{\n(?:[^\n]*\n)*?\};\n\n`, "g"),
    "",
  );
  text = removeDefinitions(
    text,
    new RegExp(
      raw`^inline (?:JSC::WeakHandleOwner\* wrapperOwner\(DOMWrapperWorld&, ${I}\*\)|void\* wrapperKey\(${I}\* wrappableObject\))$`,
    ),
  );
  text = text.replace(
    new RegExp(raw`^static_assert\(std::is_base_of<ActiveDOMObject, ${I}>::value, [^\n]*\n\n?`, "gm"),
    "",
  );
  text = text.replace(new RegExp(raw`^JS${I}Owner::JS${I}Owner\(ClangVTableWorkaroundTag\) \{ \}\n\n`, "gm"), "");
  return removeDefinitions(
    text,
    new RegExp(raw`^(?:bool|void) JS${I}Owner::(?:isReachableFromOpaqueRoots|finalize)\(`),
  );
}

function removeEnumeration(text: string, enumeration: string): string {
  const e = escapeRegExp(enumeration);
  text = removeDefinitions(
    text,
    new RegExp(raw`^(?:String convertEnumerationToString\(${e} |template<> [^\n]*(?:<${e}>|, ${e} ))[^;]*$`),
  );
  return text.replace(
    new RegExp(raw`^(?:String convertEnumerationToString\(${e}\)|template<> [^\n]*${e}[^\n]*);\n`, "gm"),
    "",
  );
}

/** What is found out in the .cpp file of an interface and needed for its header. */
interface State {
  offBySetting: string[];
  hasNoInstanceTable: boolean;
  hasNoAnalyzeHeap: boolean;
}

// An instance's own table ([LegacyUnforgeable]) is looked up through a precomputed index, so it cannot lose a row. It can go as a whole.
function fixInstanceTable(text: string, I: string, state: State): string {
  if (state.hasNoInstanceTable) return text.replaceAll(" | JSC::HasStaticPropertyTable", "");
  const table = text.match(new RegExp(raw`static const HashTable JS${I}Table = \{ (\d+), [^\n]*\n`));
  const values = text.match(new RegExp(raw`static const std::array<HashTableValue, (\d+)> JS${I}TableValues \{\n`));
  if (!table || !values || table[1] === values[1]) return text;
  if (values[1] !== "0") throw new Error(`JS${I}Table lost some of its rows: its index has to be computed again`);
  let tables: number, uses: number;
  [text, tables] = replaceAndCount(
    text,
    new RegExp(
      raw`/\* Hash table \*/\n+static const struct CompactHashIndex JS${I}TableIndex\[\d+\] = \{\n(?:[^\n]*\n)*?\};\n+static const std::array<HashTableValue, 0> JS${I}TableValues \{\n+\};\n+static const HashTable JS${I}Table = [^\n]*\n`,
      "g",
    ),
    "",
  );
  [text, uses] = replaceAndCount(text, new RegExp(raw`&Base::s_info, &JS${I}Table\n`, "g"), "&Base::s_info, nullptr\n");
  if (tables !== 1 || uses !== 1) throw new Error(`cannot take out JS${I}Table`);
  state.hasNoInstanceTable = true;
  return text;
}

function addInclude(text: string, I: string, header: string): string {
  const [result, count] = replaceAndCount(
    text,
    new RegExp(raw`(#include "config\.h"\n#include "JS${I}\.h"\n\n)`, "g"),
    `$1#include "${header}"\n`,
  );
  if (count !== 1) throw new Error(`cannot add an include to JS${I}.cpp`);
  return result;
}

// The `on*` attributes. The generator prints four functions for each (about 800 bytes of code), 206 of them for an interface with GlobalEventHandlers.
// They differ in the event's name only, so each accessor becomes one call of a function template in bindings/js/JSEventHandlerAttribute.h,
// which has the generator's lines and takes the event's member of EventNames as an argument.
function outlineEventHandlers(text: string, I: string): string {
  const accessors = new RegExp(
    raw`static inline JSValue js${I}_(?<name>on\w+)Getter\(JSGlobalObject& lexicalGlobalObject, JS${I}& thisObject\)
\{
    UNUSED_PARAM\(lexicalGlobalObject\);
    return (?<get>\w+)\(protect\(thisObject\.wrapped\(\)\), eventNames\(\)\.(?<event>\w+)Event, protect\(worldForDOMObject\(thisObject\)\)\);
\}

JSC_DEFINE_CUSTOM_GETTER\(js${I}_\k<name>, \(JSGlobalObject\* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName\)\)
\{
    return IDLAttribute<JS${I}>::get<js${I}_\k<name>Getter(?<getcast>(?:, CastedThisErrorBehavior::\w+)?)>\(\*lexicalGlobalObject, thisValue, attributeName\);
\}

static inline bool setJS${I}_\k<name>Setter\(JSGlobalObject& lexicalGlobalObject, JS${I}& thisObject, JSValue value\)
\{
    auto& vm = JSC::getVM\(&lexicalGlobalObject\);
    UNUSED_PARAM\(vm\);
    (?<set>\w+)<(?<listener>\w+)>\(protect\(thisObject\.wrapped\(\)\), eventNames\(\)\.\k<event>Event, value, thisObject\);
    vm\.writeBarrier\(&thisObject, value\);
    ensureStillAliveHere\(value\);

    return true;
\}

JSC_DEFINE_CUSTOM_SETTER\(setJS${I}_\k<name>, \(JSGlobalObject\* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName\)\)
\{
    return IDLAttribute<JS${I}>::set<setJS${I}_\k<name>Setter(?<setcast>(?:, CastedThisErrorBehavior::\w+)?)>\(\*lexicalGlobalObject, thisValue, encodedValue, attributeName\);
\}

`,
    "g",
  );
  let count: number;
  [text, count] = replaceAndCount(text, accessors, (...match) => {
    const m = groupsOf(match);
    const onWindow = m.get === "windowEventHandlerAttribute" && m.set === "setWindowEventHandlerAttribute";
    if (!onWindow && !(m.get === "eventHandlerAttribute" && m.set === "setEventHandlerAttribute"))
      throw new Error(`${I}.${m.name} calls ${m.get}() and ${m.set}()`);
    const kind = !onWindow
      ? "OwnEventHandlerAttribute"
      : I === "Window"
        ? "WindowEventHandlerAttribute<JSWindow>"
        : "WindowEventHandlerAttribute<JSHTMLElement>";
    const byDefault = ", CastedThisErrorBehavior::Throw";
    return `JSC_DEFINE_CUSTOM_GETTER(js${I}_${m.name}, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    return eventHandlerAttributeGetter<JS${I}, ${kind}${m.getcast || byDefault}>(thisValue, &EventNames::${m.event}Event);
}

JSC_DEFINE_CUSTOM_SETTER(setJS${I}_${m.name}, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    return eventHandlerAttributeSetter<JS${I}, ${kind}, ${m.listener}${m.setcast || byDefault}>(lexicalGlobalObject, thisValue, encodedValue, attributeName, &EventNames::${m.event}Event);
}

`;
  });
  if (!count) return text;
  if (!text.includes('#include "JSEventListener.h"\n'))
    throw new Error(`JS${I}.cpp does not include JSEventListener.h`);
  return text.replace(
    '#include "JSEventListener.h"\n',
    '#include "JSEventHandlerAttribute.h"\n#include "JSEventListener.h"\n',
  );
}

// The list in bindings/js/JSReflectedAttribute.h.
const reflectedAttributeMembers = new Set([
  "attributeWithoutSynchronization",
  "getURLAttributeForBindings",
  "hasAttributeWithoutSynchronization",
  "integralAttribute",
  "numericAttribute",
  "unsignedIntegralAttribute",
  "setAttributeWithoutSynchronization",
  "setBooleanAttribute",
  "setElementAttribute",
  "setElementsArrayAttribute",
  "setIntegralAttribute",
  "setNumericAttribute",
  "setUnsignedIntegralAttribute",
]);

// The attributes that reflect a content attribute. The generator prints the whole work into each accessor (a string setter is 470 bytes, and there are 350).
// They differ in the content attribute's name only, so each becomes one call of a function template in bindings/js/JSReflectedAttribute.h,
// which has the generator's lines and takes the name as an argument. An accessor stays a function of its own: nothing is looked up at run time.
// Such an accessor costs five instructions more (it sets up a frame and jumps), so the ones in `hotReflectedAttributes` stay as the generator prints them.
function outlineReflectedAttributes(text: string, I: string): string {
  const getter = new RegExp(
    raw`static inline JSValue js${I}_(?<name>\w+)Getter\(JSGlobalObject& lexicalGlobalObject, JS${I}& thisObject\)
\{
    auto& vm = JSC::getVM\(&lexicalGlobalObject\);
    auto throwScope = DECLARE_THROW_SCOPE\(vm\);
    SUPPRESS_UNCOUNTED_LOCAL auto& impl = thisObject\.wrapped\(\);
    RELEASE_AND_RETURN\(throwScope, \(toJS<(?<idl>[^\n]+?)>\(lexicalGlobalObject, throwScope, impl\.(?<member>\w+)\((?<attribute>WebCore::HTMLNames::\w+Attr)\)\)\)\);
\}

(?<head>JSC_DEFINE_CUSTOM_GETTER\(js${I}_\k<name>, \(JSGlobalObject\* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName\)\)
\{
)    return IDLAttribute<JS${I}>::get<js${I}_\k<name>Getter, CastedThisErrorBehavior::Assert>\(\*lexicalGlobalObject, thisValue, attributeName\);
\}
`,
    "g",
  );
  const setter = new RegExp(
    raw`static inline bool setJS${I}_(?<name>\w+)Setter\(JSGlobalObject& lexicalGlobalObject, JS${I}& thisObject, JSValue value\)
\{
    auto& vm = JSC::getVM\(&lexicalGlobalObject\);
    UNUSED_PARAM\(vm\);
    auto throwScope = DECLARE_THROW_SCOPE\(vm\);
(?<reactions>    CustomElementReactionStack customElementReactionStack\(lexicalGlobalObject\);
|    CustomElementReactionDisallowedScope customElementReactionDisallowedScope;
|)    SUPPRESS_UNCOUNTED_LOCAL auto& impl = thisObject\.wrapped\(\);
    auto nativeValueConversionResult = convert<(?<idl>[^\n]+?)>\(lexicalGlobalObject, value\);
    if \(nativeValueConversionResult\.hasException\(throwScope\)\) \[\[unlikely\]\]
        return false;
    invokeFunctorPropagatingExceptionIfNecessary\(lexicalGlobalObject, throwScope, \[&\] \{
        return impl\.(?<member>\w+)\((?<attribute>WebCore::HTMLNames::\w+Attr), nativeValueConversionResult\.releaseReturnValue\(\)\);
    \}\);
    return true;
\}

(?<head>JSC_DEFINE_CUSTOM_SETTER\(setJS${I}_\k<name>, \(JSGlobalObject\* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName\)\)
\{
)    return IDLAttribute<JS${I}>::set<setJS${I}_\k<name>Setter>\(\*lexicalGlobalObject, thisValue, encodedValue, attributeName\);
\}
`,
    "g",
  );
  let count = 0;
  const stays = (m: Record<string, string>) =>
    !reflectedAttributeMembers.has(m.member) || hotReflectedAttributes.has(`${I}.${m.name}`);
  text = text.replace(getter, (...match) => {
    const m = groupsOf(match);
    if (stays(m)) return match[0];
    count++;
    return `${m.head.replace("PropertyName attributeName", "PropertyName")}    return reflectedAttribute<JS${I}, ${m.idl}, ReflectedAttributeMember::${m.member}>(lexicalGlobalObject, thisValue, ${m.attribute});\n}\n`;
  });
  text = text.replace(setter, (...match) => {
    const m = groupsOf(match);
    if (stays(m)) return match[0];
    count++;
    const reactions = m.reactions.includes("ReactionStack") ? "Needed" : m.reactions ? "NotNeeded" : "None";
    return `${m.head}    return setReflectedAttribute<JS${I}, ${m.idl}, ReflectedAttributeMember::${m.member}, ReflectedAttributeReactions::${reactions}>(lexicalGlobalObject, thisValue, encodedValue, attributeName, ${m.attribute});\n}\n`;
  });
  return count ? addInclude(text, I, "JSReflectedAttribute.h") : text;
}

// What a wrapper class does once for each global object: it makes its structures, its prototype and its constructor.
// The generator prints that into every class. The work moves to bindings/js/JSDOMClassSetup.cpp and JSDOMConstructorBase::initializeBaseProperties(),
// and the constants stay here.
function outlineClassSetup(text: string, I: string, generatedHeader: string, state: State): string {
  let count = 0;
  const replace = (pattern: string, replacement: string | ((...match: any[]) => string)) => {
    let n: number;
    [text, n] = replaceAndCount(text, new RegExp(pattern, "g"), replacement);
    count += n;
  };
  replace(
    raw`    return JSC::Structure::create\(vm, globalObject, prototype, (JSC::TypeInfo\([^\n]*?, StructureFlags\)), info\(\), (JSC::\w+)\);\n`,
    "    return createDOMStructure(vm, globalObject, prototype, $1, info(), $2);\n",
  );
  // A prototype that does something between the two lines (Symbol.iterator, Symbol.unscopables) stays, so that the order of its own keys stays.
  replace(
    raw`    reifyStaticProperties\(vm, JS${I}::info\(\), JS${I}PrototypeTableValues, \*this\);
((?:[^\n]*\n)*?)    WebCore::putDirectWithoutTransition\(this, vm, vm\.propertyNames->toStringTagSymbol, jsNontrivialString\(vm, info\(\)->className\), JSC::PropertyAttribute::DontEnum \| JSC::PropertyAttribute::ReadOnly\);
`,
    (all, between) =>
      between ? all : `    finishCreatingDOMPrototype(vm, *this, JS${I}::info(), JS${I}PrototypeTableValues);\n`,
  );
  replace(
    raw`(JSC_DEFINE_CUSTOM_GETTER\(js${I}Constructor, \(JSGlobalObject\* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName\)\)
\{
)    auto& vm = JSC::getVM\(lexicalGlobalObject\);
    auto throwScope = DECLARE_THROW_SCOPE\(vm\);
    auto\* prototype = dynamicDowncast<JS${I}Prototype>\(JSValue::decode\(thisValue\)\);
    if \(!prototype\) \[\[unlikely\]\]
        return throwVMTypeError\(lexicalGlobalObject, throwScope\);
    return JSValue::encode\(JS${I}::getConstructor\(vm, prototype->realm\(\)\)\);
`,
    `$1    return constructorOfDOMPrototype(lexicalGlobalObject, thisValue, JS${I}Prototype::info(), JS${I}::getConstructor);\n`,
  );
  replace(
    raw`    putDirect\(vm, vm\.propertyNames->length, jsNumber\((\d+)\), JSC::PropertyAttribute::ReadOnly \| JSC::PropertyAttribute::DontEnum\);
    JSString\* nameString = jsNontrivialString\(vm, ("\w+"_s)\);
    m_originalName\.set\(vm, this, nameString\);
    putDirect\(vm, vm\.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly \| JSC::PropertyAttribute::DontEnum\);
    putDirect\(vm, vm\.propertyNames->prototype, (JS${I}::prototype\(vm, globalObject\)), JSC::PropertyAttribute::ReadOnly \| JSC::PropertyAttribute::DontEnum \| JSC::PropertyAttribute::DontDelete\);
`,
    "    initializeBaseProperties(vm, $1, $2, $3);\n",
  );
  // analyzeHeap() says what is wrapped and gives the cell a label, then calls the base class. When that is a wrapper class too,
  // it says the same again and has the last word, so the derived class's goes.
  const base = generatedHeader.match(
    new RegExp(raw`^class (?:WEBCORE_EXPORT )?JS${I} (?:final )?: public (JS\w+) \{`, "m"),
  );
  if (base && base[1] !== "JSDOMObject") {
    let n: number;
    [text, n] = replaceAndCount(
      text,
      new RegExp(
        raw`void JS${I}::analyzeHeap\(JSCell\* cell, HeapAnalyzer& analyzer\)
\{
    auto\* thisObject = uncheckedDowncast<JS${I}>\(cell\);
    analyzer\.setWrappedObjectForCell\(cell, &thisObject->wrapped\(\)\);
    if \(RefPtr context = thisObject->scriptExecutionContext\(\)\)
        analyzer\.setLabelForCell\(cell, makeString\("url "_s, context->url\(\)\.string\(\)\)\);
    Base::analyzeHeap\(cell, analyzer\);
\}

`,
        "g",
      ),
      "",
    );
    if (n) state.hasNoAnalyzeHeap = true;
  }
  return count ? addInclude(text, I, "JSDOMClassSetup.h") : text;
}

function removeAnalyzeHeapDeclaration(text: string, I: string): string {
  const [result, count] = replaceAndCount(text, /    static void analyzeHeap\(JSCell\*, JSC::HeapAnalyzer&\);\n/g, "");
  if (count !== 1) throw new Error(`JS${I}.h does not declare analyzeHeap()`);
  return result;
}

// A dictionary that inherits from another one. The generator converts the inherited members again in each derived dictionary (MouseEventInit's 25 in
// WheelEventInit, DragEventInit, PointerEventInit, ...). The inherited members come first, in the parent's order, so the parent's own function can convert them.
function convertInheritedMembersThroughParent(text: string, knownHeaders: Set<string>): string {
  const conversion =
    /^template<> ConversionResult<IDLDictionary<(?<type>[\w:]+)>> convertDictionary<\k<type>>\(JSGlobalObject& lexicalGlobalObject, JSValue value\)\n\{\n(?<body>(?:[^\n]*\n)*?)\}\n/gm;
  const parents = new Set<string>();
  text = text.replace(conversion, (...match) => {
    const { type, body } = groupsOf(match);
    const result = body.match(
      new RegExp(
        raw`    return ${escapeRegExp(type)} \{\n        (?<parent>\w+) \{\n(?<inherited>(?:            [^\n]*\n)*)        \},\n(?<own>(?:        [^\n]*\n)*)    \};\n$`,
      ),
    );
    if (!result || !knownHeaders.has(`JS${result.groups!.parent}.h`)) return match[0];
    const { parent, inherited, own } = result.groups!;
    // Where the conversion of a member begins: at the declaration of the JSValue it converts, if it has one.
    const start = (name: string): number => {
      const statement = body.match(new RegExp(raw`^    auto ${name}ConversionResult = [^\n]*`, "m"));
      if (!statement) throw new Error(`${type}: no conversion of ${name}`);
      for (const [value] of statement[0].matchAll(/\b\w+Value\b/g)) {
        const declaration = body.match(new RegExp(raw`^    JSValue ${value};\n`, "m"));
        if (declaration) return declaration.index!;
      }
      return statement.index!;
    };
    const startsOf = (block: string) =>
      Array.from(block.matchAll(/(\w+)ConversionResult\.releaseReturnValue\(\)/g), m => start(m[1]));
    const inheritedStarts = startsOf(inherited);
    const ownStarts = startsOf(own);
    const end = ownStarts.length ? Math.min(...ownStarts) : result.index!;
    if (!inheritedStarts.length || Math.max(...inheritedStarts) > end)
      throw new Error(`${type}: the inherited members do not come first`);
    parents.add(parent);
    let rewritten =
      body.slice(0, Math.min(...inheritedStarts)) +
      `    auto inheritedConversionResult = convertDictionary<${parent}>(lexicalGlobalObject, value);\n` +
      "    if (inheritedConversionResult.hasException(throwScope)) [[unlikely]]\n        return ConversionResultException { };\n" +
      body.slice(end, result.index) +
      `    return ${type} {\n        inheritedConversionResult.releaseReturnValue(),\n${own}    };\n`;
    if (!ownStarts.length) {
      // Nothing but the parent's function looks at the object.
      rewritten = rewritten.replace(
        /    bool isNullOrUndefined = value\.isUndefinedOrNull\(\);\n    auto\* object = [^\n]*\n    if \(!isNullOrUndefined && !object\) \[\[unlikely\]\] \{\n        throwTypeError\(&lexicalGlobalObject, throwScope\);\n        return ConversionResultException \{ \};\n    \}\n/g,
        "",
      );
    }
    return match[0].replace(body, () => rewritten);
  });
  for (const parent of [...parents].sort())
    if (!text.includes(`#include "JS${parent}.h"`))
      text = text.replace(/(#include "config\.h"\n#include "JS\w+\.h"\n\n)/, `$1#include "JS${parent}.h"\n`);
  return text;
}

function tidy(text: string): string {
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/^#if [^\n]*\n\n*#endif\n\n?/gm, "");
    text = text.replace(/^#if [^\n]*\n\n*#else\n\n*#endif\n\n?/gm, "");
  }
  text = text.replace(
    /    bool hasDisabledRuntimeProperties = false;\n    if \(hasDisabledRuntimeProperties && structure\(\)->isDictionary\(\)\)\n        flattenDictionaryObject\(vm\);\n/g,
    "",
  );
  return text.replace(/\n{3,}/g, "\n\n");
}

function adaptFile(
  generated: string,
  I: string,
  isHeader: boolean,
  generatedHeader: string,
  knownHeaders: Set<string>,
  state: State,
): string {
  const name = `JS${I}.${isHeader ? "h" : "cpp"}`;
  let text = useQuotedIncludes(generated);
  for (const [pattern, replacement] of rulesForEveryFile) text = text.replace(pattern, replacement);
  text = text.replace(RUNTIME_ENABLED_MEMBER, (_, _if, condition, member) => {
    if (!evaluate(condition) && !state.offBySetting.includes(member)) state.offBySetting.push(member);
    return "";
  });
  text = text.replace(CONDITIONAL_DICTIONARY_MEMBER, conditionalDictionaryMember);
  for (const member of [...state.offBySetting, ...(removedMembers[I] ?? [])]) text = removeMember(text, I, member);
  text = fixInstanceTable(text, I, state);
  for (const attribute of readonlyAttributes[I] ?? []) text = makeReadonly(text, I, attribute);
  if (notActiveDOMObjects.includes(I)) text = removeActiveDOMObject(text, I);
  for (const enumeration of removedEnumerations[I] ?? []) text = removeEnumeration(text, enumeration);
  // toJSNewlyCreated() tries the subclasses the generator knows of. One without a binding in Bun goes.
  text = text.replace(
    /    if \(is<(\w+)>\(impl\)\)\n        return toJSNewlyCreated\(lexicalGlobalObject, globalObject, uncheckedDowncast<\1>\(WTF::move\(impl\)\)\);\n/g,
    (all, subclass) => (knownHeaders.has(`JS${subclass}.h`) ? all : ""),
  );
  for (const attribute of withoutDOMJIT[I] ?? []) text = removeDOMJIT(text, I, attribute);
  if (!isHeader) {
    text = outlineEventHandlers(text, I);
    text = outlineReflectedAttributes(text, I);
  }
  for (const [pattern, replacement] of rulesForOneFile[name] ?? []) text = text.replace(pattern, replacement);
  text = tidy(dropUnknownIncludes(text, knownHeaders));
  if (isHeader) return state.hasNoAnalyzeHeap ? removeAnalyzeHeapDeclaration(text, I) : text;
  text = outlineClassSetup(text, I, generatedHeader, state);
  return convertInheritedMembersThroughParent(text, knownHeaders);
}

/** `generated` is what CodeGeneratorJS.pm printed for `interfaceName`. `knownHeaders` has the name of every header that Bun can include. */
export function adaptBinding(interfaceName: string, generated: Binding, knownHeaders: Set<string>): Binding {
  const state: State = { offBySetting: [], hasNoInstanceTable: false, hasNoAnalyzeHeap: false };
  // The implementation first: it is where the runtime-enabled members are found.
  const implementation = adaptFile(
    generated.implementation,
    interfaceName,
    false,
    generated.header,
    knownHeaders,
    state,
  );
  const header = adaptFile(generated.header, interfaceName, true, generated.header, knownHeaders, state);
  return { header, implementation };
}
