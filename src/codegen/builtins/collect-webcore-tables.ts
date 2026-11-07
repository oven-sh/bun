// The classes that src/jsc/bindings keeps in the form of WebKit's CodeGeneratorJS: `static const HashTableValue JS<X>PrototypeTableValues[]` lists the members,
// and the body of each member states the IDL type of what it makes: `toJS<IDLBoolean>(..)`. The C++ says which members there are and proves what they answer.
// A global leads to its C++ class by ZigGlobalObject.lut.txt (`FormData DOMFormDataConstructorCallback`) and WEBCORE_GENERATED_CONSTRUCTOR_GETTER(DOMFormData): JSDOMFormData.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Declaration, MemberDeclaration, Problems, Source, SourcedDeclaration } from "./declarations.ts";
import * as b from "./lib.ts";
import { compareBytes } from "./paths.ts";
import type { BuiltinPath, CppClassRef } from "./vocabulary.ts";

const bindingsDirectory = join("src", "jsc", "bindings");
const globalObjectFile = join(bindingsDirectory, "ZigGlobalObject.cpp");
const globalTableFile = join(bindingsDirectory, "ZigGlobalObject.lut.txt");
const ownBunRoot = join(import.meta.dir, "..", "..", "..");

export interface WebCoreClass {
  global: string;
  cppClass: string;
  header: string;
  file: string;
  text: string;
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.name.endsWith(".cpp") ? [path] : [];
  });
}

const tablePattern = /static const HashTableValue (\w+)\[\] = \{/g;

const classesOfRoot = new Map<string, WebCoreClass[]>();

export function findWebCoreClasses(bunRoot: string): WebCoreClass[] {
  const known = classesOfRoot.get(bunRoot);
  if (known !== undefined) return known;
  const globalObject = readFileSync(join(bunRoot, globalObjectFile), "utf8");
  const withGetter = new Set(
    Array.from(globalObject.matchAll(/^WEBCORE_GENERATED_CONSTRUCTOR_GETTER\((\w+)\)/gm), match => match[1]),
  );
  const paths = listSourceFiles(join(bunRoot, bindingsDirectory)).sort(compareBytes);
  const files = new Map(paths.map(path => [path.split(sep).at(-1), path]));
  const classes: WebCoreClass[] = [];
  for (const [, global, name] of readFileSync(join(bunRoot, globalTableFile), "utf8").matchAll(
    /^\s+(\w+)\s+(\w+)ConstructorCallback\s+\S*PropertyCallback\S*\s*$/gm,
  )) {
    const cppClass = `JS${name}`;
    const path = files.get(`${cppClass}.cpp`);
    // The file that defines the getters includes the header under the spelling that this target resolves.
    const header = new RegExp(`^#include "((?:\\w+/)*${cppClass}\\.h)"$`, "m").exec(globalObject)?.[1];
    if (!withGetter.has(name) || path === undefined || header === undefined) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes(`const ClassInfo ${cppClass}::s_info`)) continue;
    classes.push({ global, cppClass, header, file: relative(bunRoot, path).split(sep).join("/"), text });
  }
  classesOfRoot.set(bunRoot, classes);
  return classes;
}

const putsTag = "Bun::putToStringTagWithoutTransition(vm, this, info());";
const putsEntriesUnderIterator =
  "putDirect(vm, vm.propertyNames->iteratorSymbol, getDirect(vm, vm.propertyNames->builtinNames().entriesPublicName()), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));";

/** For a declaration file that declares the class of a global: its prototype object has the rows of the C++ table, the tag and the iterator, which collectWebCoreTables() lists, and finishCreation() puts nothing else on it. */
export function prototypeBehindGlobalListsAllMembers(global: string): true | undefined {
  const found = findWebCoreClasses(ownBunRoot).find(candidate => candidate.global === global);
  if (found === undefined) return undefined;
  const { cppClass, text } = found;
  const body = bodyOf(text, `${cppClass}Prototype::finishCreation`);
  const table = tableOf(found, "Prototype");
  if (body === null || table === null) return undefined;
  const read = new Set([
    "Base::finishCreation(vm);",
    `Bun::reifyStaticPropertyTable(vm, ${cppClass}::info(), ${cppClass}PrototypeTableValues, *this);`,
    putsTag,
    putsEntriesUnderIterator,
  ]);
  const linesOf = (part: string): string[] =>
    part
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "");
  const rows = linesOf(table);
  const isWholeTableRead =
    rows.length === Array.from(table.matchAll(rowPattern)).length &&
    rows.every(row =>
      /HashTableValue::(?:NativeFunction|GetterSetter)Type|HashTableValue::ConstantType, -?\d+ \}/.test(row),
    );
  return isWholeTableRead && linesOf(body).every(line => read.has(line)) ? true : undefined;
}

/** For a declaration file that declares the class of a global: the C++ class of its instances, whose ClassInfo tests them. */
export function cppClassBehindGlobal(global: string): CppClassRef | undefined {
  const found = findWebCoreClasses(ownBunRoot).find(candidate => candidate.global === global);
  return found === undefined ? undefined : b.cppClass(found.cppClass, found.header);
}

// ---- The text of a function

function textBetween(text: string, open: number, opening: string, closing: string): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === opening) depth++;
    else if (text[index] === closing && --depth === 0) return text.slice(open + 1, index);
  }
  return null;
}

function bodyOf(text: string, name: string): string | null {
  const head = new RegExp(`(?:^|\\n)[^\\n;]*\\b${name}\\s*(?:,\\s*)?\\([^;{]*\\)\\)?\\s*\\n?\\{`).exec(text);
  return head === null ? null : textBetween(text, head.index + head[0].length - 1, "{", "}");
}

// ---- What a body answers

interface Answers {
  idlTypes: string[];
  /** IDLOperation<JSX>::call and IDLAttribute<JSX>::get throw on a receiver that is no JSX. */
  testsReceiver: boolean;
  /** Every body takes its operands through conversions that hand native code nothing of the operand to write to. */
  changesNoOperand: boolean;
}

// convert<> of these reads the operand and runs its code. What native code gets is a copy, a wrapped object of its own kind, or a function to keep and call.
// Not among them: IDLAny and IDLObject (the value itself), buffers and views (their memory), a dictionary (its members may be any of those).
const conversionsThatOnlyRead = new Set(
  `IDLDOMString IDLUSVString IDLByteString IDLBoolean IDLEnumeration IDLByte IDLOctet IDLShort IDLUnsignedShort IDLLong IDLUnsignedLong IDLLongLong
   IDLUnsignedLongLong IDLFloat IDLUnrestrictedFloat IDLDouble IDLUnrestrictedDouble IDLAtomStringAdaptor IDLRequiresExistingAtomStringAdaptor
   IDLLegacyNullToEmptyStringAdaptor IDLEnforceRangeAdaptor IDLClampAdaptor IDLNullable IDLOptional IDLUnion IDLSequence IDLRecord IDLInterface
   IDLCallbackFunction IDLCallbackInterface IDLEventListener`.split(/\s+/),
);

const namesOnlyConversionsThatRead = (idlType: string): boolean =>
  Array.from(idlType.matchAll(/\bIDL\w+/g)).every(([name]) => conversionsThatOnlyRead.has(name));

const waysToLookAtOperand = [
  /\bEnsureStillAliveScope argument\d+ = callFrame->(?:uncheckedArgument|argument)\(\d+\);/g,
  /\b(?:JSC::)?JSValue distinguishingArg = callFrame->uncheckedArgument\(\d+\);/g,
  /\b(?:argument\d+\.value\(\)|distinguishingArg)\.(?:is\w+|inherits<\w+>)\(\)/g,
  /\basObject\(distinguishingArg\)->inherits<\w+>\(\)/g,
  // JSDOMFormData.cpp: the native part of a Blob is shared, a File is told by a flag of that part, and the wrapper is kept.
  /\bBlob::create\(argument\d+\.value\(\)\)/g,
  /\bJSDOMFile__hasInstance\(JSValue::encode\(jsUndefined\(\)\), lexicalGlobalObject, JSValue::encode\(argument\d+\.value\(\)\)\)/g,
  /\bblobValue->setWrapper\(asObject\(argument\d+\.value\(\)\)\)/g,
  /\bcallFrame->argumentCount\(\)/g,
  /\bUNUSED_PARAM\(callFrame\);/g,
  // The bodies behind these are read in their turn, and iteratorForEach() calls its operand.
  /\b\w+(?:Body|Dispatcher|Caller)\(lexicalGlobalObject, callFrame\b/g,
  /::call\w*<\w+(?:, [\w:]+)?>\(\*lexicalGlobalObject, \*callFrame\b/g,
  /\biteratorForEach<\w+>\(\*lexicalGlobalObject, \*callFrame\b/g,
];

function changesNoOperand(body: string): boolean {
  let rest = body;
  for (;;) {
    const conversion = /\bconvert<|\bconvertOptionalWithDefault</.exec(rest);
    if (conversion === null) break;
    const typeStart = conversion.index + conversion[0].length - 1;
    const type = textBetween(rest, typeStart, "<", ">");
    if (type === null || !namesOnlyConversionsThatRead(type)) return false;
    const operandsStart = typeStart + type.length + 2;
    const operands = rest[operandsStart] === "(" ? textBetween(rest, operandsStart, "(", ")") : null;
    if (operands === null) return false;
    rest = rest.slice(0, conversion.index) + rest.slice(operandsStart + operands.length + 2);
  }
  for (const way of waysToLookAtOperand) rest = rest.replace(way, "");
  return !/\bargument\d+\b|\bdistinguishingArg\b|\bcallFrame\b/.test(rest);
}

const valuesMadeDirectly: Readonly<Record<string, string>> = {
  Undefined: "IDLUndefined",
  Null: "IDLNull",
  Boolean: "IDLBoolean",
  Number: "IDLDouble",
  String: "IDLDOMString",
  StringWithCache: "IDLDOMString",
  OwnedString: "IDLDOMString",
  NontrivialString: "IDLDOMString",
  EmptyString: "IDLDOMString",
};

const emptyValue = /^return (?:\{\s*\}|encodedJSValue\(\)|(?:JSC::)?JSValue::encode\((?:JSC::)?JSValue\s*\{\s*\}\));$/;
const valueMadeDirectly = /^return (?:(?:JSC::)?JSValue::encode\()?(?:JSC::)?js(\w+)\(/;
const throwsOnly = /\bthrow\w*\(|\bBun::ERR::\w+\(|\brejectPromiseWith\w*\(/;
const entersBody =
  /\b(?:IDLOperation|IDLAttribute)<(\w+)>::(?:call|get)<(\w+)[,>]|\b(?:IDLOperation|IDLAttribute)<\w+>::(?:callStatic|getStatic)<(\w+)[,>]|\(\(?(\w+(?:Body|Dispatcher|Caller|Getter))\(/g;

// Null unless every `return` of the body, and of the bodies that it hands the call to, is one that this reads.
function answersOf({ text, cppClass }: WebCoreClass, name: string, seen: Set<string>): Answers | null {
  if (seen.has(name)) return { idlTypes: [], testsReceiver: false, changesNoOperand: true };
  seen.add(name);
  const body = bodyOf(text, name);
  if (body === null) return null;
  const answers: Answers = { idlTypes: [], testsReceiver: false, changesNoOperand: changesNoOperand(body) };
  for (const line of body.split("\n").map(untrimmed => untrimmed.trim())) {
    if (!/^(?:return\b|RELEASE_AND_RETURN\()/.test(line)) continue;
    if (!line.endsWith(";")) return null;
    // One of two values: only where both throw is it plain what the line answers.
    if (line.includes(" ? ") && /\btoJS|\bencode\(|\bjs[A-Z]\w*\(/.test(line)) return null;
    // A receiver of another class is answered with something else than a throw.
    if (line.includes("CastedThisErrorBehavior::") && !/CastedThisErrorBehavior::(?:Assert|Throw)\b/.test(line))
      return null;
    const conversions = Array.from(line.matchAll(/\btoJS(?:NewlyCreated)?</g));
    if (conversions.length > 0) {
      for (const conversion of conversions) {
        const type = textBetween(line, conversion.index + conversion[0].length - 1, "<", ">");
        if (type === null) return null;
        answers.idlTypes.push(type);
      }
      continue;
    }
    const iterator = /\biteratorCreate<(\w+)>\(\*thisObject, IterationKind::\w+\)/.exec(line);
    if (iterator !== null) {
      answers.idlTypes.push(`Iterator<${iterator[1]}>`);
      continue;
    }
    if (/\biteratorForEach<\w+>\(/.test(line)) {
      answers.idlTypes.push("IDLUndefined");
      continue;
    }
    // JSDOMOperationReturningPromise.h: the promise is made ahead of the body and answered whatever the body does. A receiver of another class rejects it.
    if (/\bIDLOperationReturningPromise<\w+>::call\w*</.test(line)) {
      answers.idlTypes.push("IDLPromise<IDLAny>");
      continue;
    }
    const entered = Array.from(line.matchAll(entersBody));
    if (entered.length > 0) {
      for (const [, receiverClass, bodyBehindTest, staticBody, otherBody] of entered) {
        const inner = answersOf({ text, cppClass } as WebCoreClass, bodyBehindTest ?? staticBody ?? otherBody, seen);
        if (inner === null) return null;
        answers.idlTypes.push(...inner.idlTypes);
        answers.testsReceiver ||= receiverClass === cppClass || inner.testsReceiver;
        answers.changesNoOperand &&= inner.changesNoOperand;
      }
      continue;
    }
    if (throwsOnly.test(line) || emptyValue.test(line)) continue;
    const made = valuesMadeDirectly[valueMadeDirectly.exec(line)?.[1] ?? ""];
    if (made === undefined) return null;
    answers.idlTypes.push(made);
  }
  return answers.idlTypes.length === 0 ? null : answers;
}

// ---- What an IDL type proves of the value that toJS<> makes

function splitTypeArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "<") depth++;
    else if (text[index] === ">") depth--;
    else if (text[index] === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, text.slice(start).trim()];
}

const numberTypes = new Set(
  `IDLByte IDLOctet IDLShort IDLUnsignedShort IDLLong IDLUnsignedLong IDLLongLong IDLUnsignedLongLong IDLFloat IDLUnrestrictedFloat
   IDLDouble IDLUnrestrictedDouble`.split(/\s+/),
);
const stringTypes = new Set(["IDLDOMString", "IDLUSVString", "IDLByteString"]);

interface TypeContext {
  /** By the name that IDLInterface<> takes. A wrapper is kept and handed out again, so an instance is never new. */
  classOfInterface: ReadonlyMap<string, string>;
  classOfIterator: ReadonlyMap<string, string>;
}

// Null for what is left undescribed: IDLAny, IDLObject, a dictionary (an object whose keys depend on the values), a callback, a frozen array, a buffer, an interface that no class of the table stands for.
function typeProvenBy(idlType: string, context: TypeContext): b.TableType | null {
  const open = idlType.indexOf("<");
  const name = open === -1 ? idlType : idlType.slice(0, open);
  const typeArguments = open === -1 ? [] : splitTypeArguments(idlType.slice(open + 1, idlType.lastIndexOf(">")));
  const proven = typeArguments.map(argument => typeProvenBy(argument, context));
  if (name === "IDLUndefined") return b.undefined;
  if (name === "IDLNull") return b.strictNull;
  if (name === "IDLBoolean") return b.bool;
  if (numberTypes.has(name)) return b.f64;
  // JSDOMConvertEnumeration.h: the text of the enumerator.
  if (stringTypes.has(name) || name === "IDLEnumeration") return b.string;
  if (name === "IDLAtomStringAdaptor" || name === "IDLRequiresExistingAtomStringAdaptor") return proven[0];
  if (name === "IDLNullable") return proven[0] === null ? null : b.union(proven[0], b.strictNull);
  if (name === "IDLUnion") {
    const [first, ...others] = proven;
    return first === null || others.includes(null) ? null : b.union(first, ...(others as b.TableType[]));
  }
  if (name === "IDLInterface") {
    const builtinClass = context.classOfInterface.get(typeArguments[0]);
    return builtinClass === undefined ? null : b.instance(builtinClass);
  }
  // JSDOMConvertSequences.h: constructArray() over the converted values, at each call.
  if (name === "IDLSequence")
    return proven[0] === null ? null : b.instance("Array").holding({ element: proven[0] }).fresh;
  // The promise is there. What it is settled with is made later, elsewhere.
  if (name === "IDLPromise") return b.instance("Promise").holding({ value: b.any, reason: b.any });
  if (name === "Iterator") {
    const builtinClass = context.classOfIterator.get(typeArguments[0]);
    return builtinClass === undefined ? null : b.instance(builtinClass).fresh;
  }
  return null;
}

function unionProvenBy(idlTypes: readonly string[], context: TypeContext): b.TableType | null {
  const [first, ...others] = [...new Set(idlTypes)].map(type => typeProvenBy(type, context));
  if (first === null || first === undefined || others.includes(null)) return null;
  return others.length === 0 ? first : b.union(first, ...(others as b.TableType[]));
}

// ---- The rows

// The C++ proves the result and the test of the receiver. convert<> runs the code of the operands, and the implementation may keep and call them and run listeners that no operand names.
// An operand of which everything is said takes the result with it: native code of which nothing is known may answer anything. So a result counts only where the bodies show that no operand is changed.
const usesOfOperands = (changesNone: boolean) => (changesNone ? b.handedOver : [b.everything]);

const answeredBy = (returns: b.TableType, receiver: b.TableType, changesNoOperand: boolean) =>
  ({
    this: receiver,
    args: { operands: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { this: b.handedOver, operands: usesOfOperands(changesNoOperand) },
    implementation: b.generic,
  }) satisfies b.FunctionField;

const readBy = (getter: b.TableType, receiver: b.TableType, hasSetter: boolean) =>
  ({
    this: receiver,
    getter,
    capability: "js",
    throws: true,
    uses: { this: b.handedOver },
    implementation: b.generic,
    ...(hasSetter
      ? {
          setter: {
            this: b.any,
            value: b.any,
            capability: "js",
            throws: true,
            uses: { this: b.handedOver, value: [b.everything] },
            implementation: b.generic,
          },
        }
      : {}),
  }) satisfies b.GetterField;

interface IteratorOfClass {
  cppClass: string;
  key: string;
  value: string;
  /** Compiled code that names a member of the prototype object asks the realm for that object. */
  prototypeCppExpression: string;
}

// `struct XIteratorTraits { type = JSDOMIteratorType::Map; using KeyType = ..; using ValueType = ..; }`, `using XIteratorBase = JSDOMIteratorBase<JSX, XIteratorTraits>`, `class XIterator final : public XIteratorBase`.
function findIterator({ text, cppClass }: WebCoreClass): IteratorOfClass | null {
  const base = new RegExp(`using (\\w+) = JSDOMIteratorBase<${cppClass}, (\\w+)>;`).exec(text);
  if (base === null) return null;
  const traits = new RegExp(`struct ${base[2]} \\{([^}]*)\\}`).exec(text)?.[1];
  const iterator = new RegExp(`class (\\w+) final : public ${base[1]}\\b`).exec(text)?.[1];
  const key = /using KeyType = ([^;]+);/.exec(traits ?? "")?.[1];
  const value = /using ValueType = ([^;]+);/.exec(traits ?? "")?.[1];
  if (iterator === undefined || key === undefined || value === undefined) return null;
  // `JSC::JSObject* xIteratorPrototype(JSDOMGlobalObject& globalObject) { return getDOMPrototype<XIterator>(globalObject.vm(), globalObject); }`, which the header of the class declares.
  const handsOutPrototype = new RegExp(
    `JSC::JSObject\\* (\\w+)\\(JSDOMGlobalObject& globalObject\\)\\s*\\{\\s*return getDOMPrototype<${iterator}>\\(globalObject\\.vm\\(\\), globalObject\\);\\s*\\}`,
  ).exec(text)?.[1];
  if (handsOutPrototype === undefined || !traits?.includes("JSDOMIteratorType::Map")) return null;
  return { cppClass: iterator, key, value, prototypeCppExpression: `${handsOutPrototype}(*globalObject)` };
}

// JSDOMIterator.h. next(): createIteratorResultObject() over the key, the value, or jsPair(), which is constructArray() over the two, by the kind that the iterator was made with; undefined behind the end.
// JSDOMIteratorPrototype::finishCreation() puts `next` and Symbol.toStringTag on the prototype object, which stands below Iterator.prototype.
function declareIterator(
  global: string,
  key: b.TableType,
  value: b.TableType,
  prototypeCppExpression: string,
): Declaration[] {
  const pair = `${global}Pair`;
  // A type has one freshness, and the pair is new where a value may be an object that is kept: each is a record of its own.
  const stepped = b.resultFieldHoldingOnlyWhatIsStored("value");
  return [
    ...b.tuple(pair, [key, value]),
    ...b.class(`%${global}Iterator%`, {
      extends: "Iterator",
      hasConstructor: false,
      prototypeCppExpression,
      stateHeap: "ExternalState",
      prototypeListsAllMembers: true,
      proto: {
        next: {
          returns: b.ordinaryObjectOf("IteratorResult").fresh,
          capability: "heap",
          throws: true,
          uses: {
            this: [
              b.createdIn(key, stepped),
              b.createdIn(value, stepped),
              b.createdIn(b.layoutOf(pair).fresh, stepped),
              b.createdIn(b.undefined, stepped),
            ],
          },
          reads: ["ExternalState"],
          writes: ["ExternalState"],
          implementation: b.generic,
        },
        "@@toStringTag": b.property(b.enumeration([`${global} Iterator`])),
      },
    }),
    // JSDOMIteratorBase stands on JSDOMObject, and neither puts a property on the cell.
    ...b.instancesWithoutOwnNames(`${global}Iterator`),
  ];
}

// `auto jsValue = toJSNewlyCreated<IDLInterface<X>>(..); .. return JSValue::encode(jsValue);`, and every other `return` throws: a construction that answers makes an instance.
function constructsInstance({ text, cppClass }: WebCoreClass): boolean {
  const body = bodyOf(text, `${cppClass}DOMConstructor::construct`);
  if (body === null) return false;
  const made = `auto jsValue = toJSNewlyCreated<IDLInterface<${cppClass.slice("JS".length)}>>(`;
  if (body.split(made).length !== 2 || /\bjsValue\s*=[^=]/.test(body.replace(made, ""))) return false;
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(line => /^(?:return\b|RELEASE_AND_RETURN\()/.test(line))
    .every(
      line =>
        line === "return JSValue::encode(jsValue);" ||
        (line.endsWith(";") && (throwsOnly.test(line) || emptyValue.test(line))),
    );
}

// These read the callee and new.target off the frame.
const constructionChangesNoOperand = ({ text, cppClass }: WebCoreClass): boolean =>
  changesNoOperand(
    (bodyOf(text, `${cppClass}DOMConstructor::construct`) ?? "callFrame")
      .replace(/\bcallFrame->jsCallee\(\)/g, "")
      .replace(/\b(?:setSubclassStructureIfNeeded|structureForNewTarget)<\w+>\(lexicalGlobalObject, callFrame\b/g, ""),
  );

const madeBy = (returns: b.TableType, changesNoOperand: boolean) =>
  ({
    args: { operands: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { operands: usesOfOperands(changesNoOperand) },
    implementation: b.generic,
  }) satisfies b.FunctionField;

const listedMember = (
  path: BuiltinPath,
  kind: MemberDeclaration["kind"],
  length: number | null,
): MemberDeclaration => ({
  declares: "Member",
  path,
  kind,
  isOwnPropertyOfInstances: false,
  isLazilyCreated: false,
  signatures: [],
  dispatches: [],
  constant: null,
  length,
  columns: {},
});

const rowPattern = /\{ "(\w+)"_s, [^{]*?, \w+, \{ HashTableValue::(\w+)Type, ([^}]*?) \} \}/g;

function tableOf({ text, cppClass }: WebCoreClass, side: "Prototype" | "Constructor"): string | null {
  const head = `static const HashTableValue ${cppClass}${side}TableValues[] = {`;
  const start = text.indexOf(head);
  return start === -1 ? null : textBetween(text, start + head.length - 1, "{", "}");
}

export interface WebCoreTables {
  declarations: SourcedDeclaration[];
  /** Members that the C++ lists, of which no row says what they answer and the bodies are not all read. */
  leftUndescribed: BuiltinPath[];
}

// blob.cpp: toJS(.., Blob&) answers the wrapper that was kept, which append() and set() take from an operand only where it inherits JSBlob, or a new JSBlob.
const interfacesOfOtherBindings: ReadonlyMap<string, string> = new Map([["Blob", "Blob"]]);

export function collectWebCoreTables(
  bunRoot: string,
  written: readonly SourcedDeclaration[],
  problems: Problems,
): WebCoreTables {
  const classes = findWebCoreClasses(bunRoot);
  const writtenMembers = new Set<BuiltinPath>();
  const writtenClasses = new Set<BuiltinPath>();
  const classesWithoutPrototype = new Set<BuiltinPath>();
  for (const { declaration } of written) {
    if (declaration.declares === "Member") writtenMembers.add(declaration.path);
    if (declaration.declares !== "Class") continue;
    writtenClasses.add(declaration.path);
    if (declaration.columns.hasPrototype === false) classesWithoutPrototype.add(declaration.path);
  }

  const declaredClasses = classes.filter(({ global }) => writtenClasses.has(global));
  const classOfInterface = new Map([
    ...interfacesOfOtherBindings,
    ...declaredClasses.map(({ global, cppClass }): [string, string] => [cppClass.slice("JS".length), global]),
  ]);
  const classOfIterator = new Map<string, string>();
  const tables: WebCoreTables = { declarations: [], leftUndescribed: [] };
  const declare = (file: string, declarations: readonly Declaration[]): void => {
    for (const declaration of declarations) {
      const hasSignatures = declaration.declares === "Member" && declaration.signatures.length > 0;
      const source: Source = {
        file,
        line: null,
        origin: "Host",
        proof: hasSignatures ? "ByConstruction" : "Structure",
      };
      tables.declarations.push({ declaration, source });
    }
  };

  for (const webCoreClass of declaredClasses) {
    const iterator = findIterator(webCoreClass);
    const iteratorPath = `%${webCoreClass.global}Iterator%`;
    if (iterator === null || writtenClasses.has(iteratorPath)) continue;
    const context: TypeContext = { classOfInterface, classOfIterator };
    const [key, value] = [typeProvenBy(iterator.key, context), typeProvenBy(iterator.value, context)];
    if (key === null || value === null) continue;
    classOfIterator.set(iterator.cppClass, `${webCoreClass.global}Iterator`);
    declare(webCoreClass.file, declareIterator(webCoreClass.global, key, value, iterator.prototypeCppExpression));
  }

  const context: TypeContext = { classOfInterface, classOfIterator };
  for (const webCoreClass of declaredClasses) {
    const { global, file, text } = webCoreClass;
    if (!writtenMembers.has(global) && constructsInstance(webCoreClass))
      declare(
        file,
        b.construction(global, madeBy(b.instance(global).fresh, constructionChangesNoOperand(webCoreClass))),
      );
    for (const [side, holder] of [
      ["Prototype", `${global}.prototype`],
      ["Constructor", global],
    ] as const) {
      const table = tableOf(webCoreClass, side);
      if (table === null) continue;
      if (side === "Prototype" && classesWithoutPrototype.has(global)) {
        tables.leftUndescribed.push(holder);
        continue;
      }
      for (const [, name, kind, operands] of table.matchAll(rowPattern)) {
        const path = `${holder}.${name}`;
        // A row written by hand wins, and `constructor` is the class's own.
        if (writtenMembers.has(path) || name === "constructor") continue;
        const [symbol, second] = operands.split(",").map(operand => operand.trim());
        if (kind === "Constant" && /^-?\d+$/.test(symbol)) {
          declare(file, b.static(path, b.constant(Number(symbol))));
          continue;
        }
        if (kind !== "NativeFunction" && kind !== "GetterSetter") {
          tables.leftUndescribed.push(path);
          continue;
        }
        const answers = answersOf(webCoreClass, symbol, new Set());
        const returns = answers === null ? null : unionProvenBy(answers.idlTypes, context);
        if (answers === null || returns === null) {
          // It is there, whatever it answers: a member that the table does not list is read as a value that nobody knows, and a call of that is a call of code that nobody knows.
          declare(file, [
            listedMember(
              path,
              kind === "GetterSetter" ? "Accessor" : side === "Prototype" ? "Method" : "Function",
              kind === "NativeFunction" ? Number(second) : null,
            ),
          ]);
          tables.leftUndescribed.push(path);
          continue;
        }
        const receiver = answers.testsReceiver ? b.instance(global) : b.any;
        const field =
          kind === "NativeFunction"
            ? answeredBy(returns, receiver, answers.changesNoOperand)
            : readBy(returns, receiver, second !== "0");
        declare(file, b.method(path, field));
      }
      const tag = new RegExp(`const ClassInfo ${webCoreClass.cppClass}Prototype::s_info = \\{ "([^"]*)"_s`).exec(
        text,
      )?.[1];
      const tagPath = `${holder}.@@toStringTag`;
      if (side === "Prototype" && tag !== undefined && text.includes(putsTag) && !writtenMembers.has(tagPath))
        declare(file, b.method(tagPath, b.property(b.enumeration([tag]))));
      // `putDirect(vm, vm.propertyNames->iteratorSymbol, getDirect(vm, ..entriesPublicName()), ..)`
      const iteratorPath = `${holder}.@@iterator`;
      const isSameAsEntries = text.includes(putsEntriesUnderIterator);
      if (
        side === "Prototype" &&
        isSameAsEntries &&
        !writtenMembers.has(iteratorPath) &&
        !writtenMembers.has(`${holder}.entries`)
      )
        declare(file, b.same(iteratorPath, `${holder}.entries`));
    }
  }

  checkEveryTableIsRead(bunRoot, classes, written, problems);
  return tables;
}

// ---- No table that nobody reads

/** The tables that nothing reads yet: no global constructor leads to their objects (a module, a function or native code hands them out), so what the table knows of their members is written by hand or not at all. A new table does not belong here: tie its class. */
export const tablesReadByNobody: readonly string[] = [
  "ImportMetaObjectBakePrototypeValues", // ImportMetaObject.cpp
  "ImportMetaObjectPrototypeValues", // ImportMetaObject.cpp
  "JSBigIntStatsPrototypeTableValues", // NodeFSStatBinding.cpp
  "JSBunRequestPrototypeValues", // JSBunRequest.cpp
  "JSBundlerPluginHashTable", // JSBundlerPlugin.cpp
  "JSConnectionsListPrototypeTableValues", // node/http/JSConnectionsListPrototype.cpp
  "JSCookieMapPrototypeTableValues", // webcore/JSCookieMap.cpp
  "JSCookiePrototypeTableValues", // webcore/JSCookie.cpp
  "JSDatabaseSyncPrototypeTableValues", // sqlite/NodeSqlite.cpp
  "JSDirentPrototypeTableValues", // NodeDirent.cpp
  "JSHTTPParserPrototypeTableValues", // node/http/JSHTTPParserPrototype.cpp
  "JSHashPrototypeTableValues", // node/crypto/JSHash.cpp
  "JSHmacPrototypeTableValues", // node/crypto/JSHmac.cpp
  "JSMIMEParamsPrototypeTableValues", // webcore/JSMIMEParams.cpp
  "JSMIMETypePrototypeValues", // webcore/JSMIMEType.cpp
  "JSMockFunctionPrototypeTableValues", // JSMockFunction.cpp
  "JSModuleGraphPrototypeTableValues", // ModuleGraph.cpp
  "JSNodeSqliteSessionPrototypeTableValues", // sqlite/NodeSqlite.cpp
  "JSNodeSqliteTagStorePrototypeTableValues", // sqlite/NodeSqlite.cpp
  "JSReadableStreamAsyncIteratorPrototypeTableValues", // webcore/streams/JSReadableStreamAsyncIterator.cpp
  "JSSQLStatementConstructorTableValues", // sqlite/JSSQLStatement.cpp
  "JSSQLStatementPrototypeTableValues", // sqlite/JSSQLStatement.cpp
  "JSStatementSyncIteratorPrototypeTableValues", // sqlite/NodeSqlite.cpp
  "JSStatementSyncPrototypeTableValues", // sqlite/NodeSqlite.cpp
  "JSStatsPrototypeTableValues", // NodeFSStatBinding.cpp
  "JSWasmStreamingCompilerPrototypeTableValues", // webcore/JSWasmStreamingCompiler.cpp
  "JSX509CertificatePrototypeTableValues", // JSX509CertificatePrototype.cpp
  "NodeVMModulePrototypeTableValues", // NodeVMModule.cpp
  "RequireFunctionPrototypeValues", // JSCommonJSModule.cpp
  "RequireResolveFunctionPrototypeValues", // JSCommonJSModule.cpp
  "TTYWrapPrototypeValues", // ProcessBindingTTYWrap.cpp
];

function checkEveryTableIsRead(
  bunRoot: string,
  classes: readonly WebCoreClass[],
  written: readonly SourcedDeclaration[],
  problems: Problems,
): void {
  const read = new Set(
    classes.flatMap(({ cppClass }) => [`${cppClass}PrototypeTableValues`, `${cppClass}ConstructorTableValues`]),
  );
  const cppClassesNamedByHand = new Set(
    written.flatMap(({ declaration }) =>
      declaration.declares === "Class" && declaration.columns.instanceCppClass !== undefined
        ? [declaration.columns.instanceCppClass.name.split("::").at(-1)]
        : [],
    ),
  );
  for (const path of listSourceFiles(join(bunRoot, bindingsDirectory))) {
    const file = relative(bunRoot, path).split(sep).join("/");
    for (const [, table] of readFileSync(path, "utf8").matchAll(tablePattern)) {
      const owner = table.replace(/(?:Prototype|Constructor)?(?:TableValues|HashTable)$/, "");
      if (read.has(table) || cppClassesNamedByHand.has(owner) || tablesReadByNobody.includes(table)) continue;
      problems.add(
        { file, line: null, origin: "Host", proof: "Structure" },
        `nobody reads ${table}: no global constructor leads to ${owner} and no class of the table names it, so the table knows none of its members. ` +
          "Name the C++ class on the class (instanceCppClass), or list the table in tablesReadByNobody of collect-webcore-tables.ts and say why",
      );
    }
  }
}
