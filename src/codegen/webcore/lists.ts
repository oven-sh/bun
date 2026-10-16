// Writes the lists that Bun's per-global and per-VM tables, the bun:dom module and `new Window()` include. They are made from the bindings themselves.
//   DOMBindingsConstructorIDs.h       enumerators of DOMConstructorID               (included by webcore/DOMConstructors.h)
//   DOMBindingsStructureSlots.h       FOR_EACH_DOM_BINDINGS_STRUCTURE_SLOT(macro)   (included by DOMStructureSlot.h)
//   DOMBindingsIsoSubspaces.h         members of DOMIsoSubspaces                    (included by webcore/DOMIsoSubspaces.h)
//   DOMBindingsClientIsoSubspaces.h   members of DOMClientIsoSubspaces              (included by webcore/DOMClientIsoSubspaces.h)
//   DOMBindingsModuleExports.h        the interfaces script sees, with their headers (included by src/jsc/modules/BunDOMModule.cpp)
//   JSWindowInterfaces.lut.txt        the rows of JSWindow's static property table. The build turns it into JSWindowInterfaces.lut.h.
//   JSWindowInterfaces.h              declares the callbacks the rows name. bindings/js/JSWindowCustom.cpp defines them.
import { hiddenInterfaces } from "./bindings-rules.ts";
import { type Files, sorted } from "./util.ts";

/** The classes that Bun has as globals: the same list as FOR_EACH_RUNTIME_INTERFACE, Blob and File in src/jsc/modules/BunDOMModule.cpp. */
// prettier-ignore
const runtimeInterfaces = ["AbortController", "AbortSignal", "Blob", "CSS", "CloseEvent", "CustomEvent", "DOMException", "ErrorEvent", "Event", "EventTarget", "File", "FormData", "MessageEvent"];

/**
 * Methods that have to keep working when they are read off a window (`const { getComputedStyle } = window`):
 * FOR_EACH_WINDOW_OPERATION in bindings/js/JSWindowCustom.cpp.
 */
// prettier-ignore
const windowOperations = ["addEventListener", "alert", "blur", "cancelAnimationFrame", "close", "confirm", "dispatchEvent", "focus", "getComputedStyle", "getSelection", "matchMedia", "moveBy", "moveTo", "open", "postMessage", "print", "prompt", "removeEventListener", "requestAnimationFrame", "resizeBy", "resizeTo", "scroll", "scrollBy", "scrollTo", "stop"];

/** `bindings` holds every JS*.cpp of the generated directory. */
export function makeLists(bindings: Files): Files {
  const constructors = new Set<string>();
  const wrappers = new Set<string>();
  const interfaces = new Map<string, string>(); // the name script sees -> the wrapper class
  const factoryFunctions = new Map<string, string>();
  const windowBound = new Set<string>(); // wrapper classes whose constructor asks for JSDOMConstructorBase::document()

  // A class without an interface object ([LegacyNoInterfaceObject], a dictionary, an enumeration, a callback function) has no such function.
  const collectNames = (text: string, kind: string, into: Map<string, string>) => {
    const pattern = new RegExp(
      String.raw`^template<> void (JS\w+)${kind}::initializeProperties\(VM& vm, JSDOMGlobalObject& globalObject\)\n\{\n([^]*?)^\}`,
      "gm",
    );
    for (const [, wrapper, body] of text.matchAll(pattern)) {
      const name = body.match(/(?:jsNontrivialString\(vm|initializeBaseProperties\(vm, \d+), "(\w+)"_s/)![1];
      if (!hiddenInterfaces.has(name)) into.set(name, wrapper);
    }
  };
  for (const [name, text] of bindings) {
    if (!/^JS.*\.cpp$/.test(name)) continue;
    for (const [, id] of text.matchAll(/DOMConstructorID::(\w+)/g)) constructors.add(id);
    for (const [, wrapper] of text.matchAll(/^JSC::GCClient::IsoSubspace\* (JS\w+)::subspaceForImpl\(/gm))
      wrappers.add(wrapper);
    collectNames(text, "DOMConstructor", interfaces);
    collectNames(text, "LegacyFactoryFunction", factoryFunctions);
    const asksForDocument =
      /uncheckedDowncast<(JS\w+)DOMConstructor>\(callFrame->jsCallee\(\)\);\n    ASSERT\(castedThis\);\n    auto\* currentDocument = castedThis->document\(\);/g;
    for (const [, wrapper] of text.matchAll(asksForDocument)) windowBound.add(wrapper);
  }
  windowBound.add("JSHTMLElement"); // constructJSHTMLElement() in bindings/js/JSHTMLElementCustom.cpp

  const files: Files = new Map();
  const note = "// Made by src/codegen/webcore/lists.ts from the files in this directory. Do not edit.\n";
  const macroList = (name: string, entries: Iterable<[string, string]>) =>
    `#define ${name}(macro) \\\n` +
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([n, w]) => `    macro(${n}, ${w})`)
      .join(" \\\n") +
    "\n";
  const lines = (values: Iterable<string>, line: (value: string) => string) => sorted(values).map(line).join("");

  files.set("DOMBindingsConstructorIDs.h", note + lines(constructors, c => `${c},\n`));
  files.set(
    "DOMBindingsStructureSlots.h",
    note +
      "#define FOR_EACH_DOM_BINDINGS_STRUCTURE_SLOT(macro) \\\n" +
      sorted(wrappers)
        .map(w => `    macro(${w})`)
        .join(" \\\n") +
      "\n",
  );
  files.set("DOMBindingsIsoSubspaces.h", note + lines(wrappers, w => `IsoSubspace* m_subspaceFor${w} { nullptr };\n`));
  files.set(
    "DOMBindingsClientIsoSubspaces.h",
    note + lines(wrappers, w => `GCClient::IsoSubspace* m_clientSubspaceFor${w} { nullptr };\n`),
  );
  files.set(
    "DOMBindingsModuleExports.h",
    note +
      "#pragma once\n\n" +
      lines(new Set(interfaces.values()), w => `#include "${w}.h"\n`) +
      "\n// macro(the name script sees, the wrapper class): JSFoo::getConstructor().\n" +
      macroList("FOR_EACH_DOM_BINDINGS_INTERFACE", interfaces) +
      '\n// The ones among them whose constructor needs "the current document": each window has its own copy (JSDOMConstructorBase::createForWindow()).\n' +
      macroList(
        "FOR_EACH_DOM_BINDINGS_WINDOW_BOUND_INTERFACE",
        [...interfaces].filter(([, w]) => windowBound.has(w)),
      ) +
      "\n// `new Image()`: JSFoo::getLegacyFactoryFunction(). All of them need the current document.\n" +
      macroList("FOR_EACH_DOM_BINDINGS_LEGACY_FACTORY_FUNCTION", factoryFunctions),
  );

  const names = sorted([...interfaces.keys(), ...factoryFunctions.keys(), ...runtimeInterfaces]);
  if (new Set(names).size !== names.length) throw new Error("a window would have two interfaces of one name");
  const width = Math.max(...names.map(n => n.length)) + 2;
  const row = (prefix: string) => (n: string) =>
    `  ${n.padEnd(width)}${(prefix + n).padEnd(width + prefix.length)}DontEnum|PropertyCallback\n`;
  const declaration = (prefix: string) => (n: string) =>
    `JSC::JSValue ${prefix}${n}(JSC::VM&, JSC::JSObject* window);\n`;
  files.set(
    "JSWindowInterfaces.lut.txt",
    note +
      "\n/* Source for JSWindowInterfaces.lut.h\n@begin jsWindowTable\n" +
      names.map(row("windowInterface_")).join("") +
      windowOperations.map(row("windowOperation_")).join("") +
      "@end\n*/\n",
  );
  files.set(
    "JSWindowInterfaces.h",
    note +
      "#pragma once\n\nnamespace JSC {\nclass JSObject;\nclass JSValue;\nclass VM;\n}\n\nnamespace WebCore {\n\n" +
      names.map(declaration("windowInterface_")).join("") +
      windowOperations.map(declaration("windowOperation_")).join("") +
      "\n} // namespace WebCore\n",
  );
  return files;
}
