import * as b from "bun-builtins-table";
import { environmentCell } from "./native-cells.ts";

const pathListRead = b.runsTransitively("OwnValues", "PrototypeChain", b.named("paths"));

// A Module._resolveFilename that the program has replaced is called with the options.
const resolveOptions = [b.retained, pathListRead];
const requireOptions = [b.retained, b.runsTransitively("OwnValues", "PrototypeChain", b.named("paths", "type"))];

// What is no string is refused as it is: nothing converts it.
const loadsModule = {
  args: { specifier: b.string, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained, b.loadedAsModule], options: requireOptions },
  implementation: b.generic,
} satisfies b.FunctionField;

// A receiver that is no module object gets undefined before anything is converted.
const compilesText = {
  args: { text: b.string.loose, filename: b.string.loose },
  returns: b.any,
  capability: "js",
  throws: true,
  readsStateBeforeConversions: true,
  // It puts require on the module, and the text gets the module.
  this: b.any,
  uses: { this: [b.everything], text: [b.evaluatedAsText] },
  implementation: b.generic,
} satisfies b.FunctionField;

const resolvesFromModule = {
  args: { specifier: b.string, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained], options: resolveOptions },
  implementation: b.generic,
} satisfies b.FunctionField;

// The receiver stands where the bound form has the module object: a Module._resolveFilename that the program has replaced is called with it.
const resolvesFromReceiver = {
  ...resolvesFromModule,
  this: b.any,
  uses: { ...resolvesFromModule.uses, this: [b.everything] },
} satisfies b.FunctionField;

const resolvesFromImportMeta = (specifier: b.TableType) =>
  ({
    this: b.any,
    args: { specifier, parent: b.any.optional, isESM: b.any.optional },
    returns: b.string,
    capability: "js",
    throws: true,
    uses: { this: [b.runs(b.named("path"))], parent: [pathListRead], isESM: b.inspected },
    implementation: b.generic,
  }) satisfies b.FunctionField;

// JSMock__jsSpyOn finds the property on the object or above it, keeps what stands there and may call it, and puts a function of its own under the name on the object
// itself: as a value where a function stood, as a getter and a setter otherwise. mockRestore() stores the original in the same place. It reads no other name and hands
// the object to nobody: it keeps it weakly. So a test that spies on one export of a module doesn't open the others.
const spiedName = b.keyFrom("method");
const spyOn = {
  args: { object: b.object, method: b.propertyKey.loose },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: {
    object: [
      b.readByKey(spiedName, b.nativeMemory),
      b.definesName(spiedName, b.callable),
      b.definesAccessor("Getter", spiedName, b.callable),
      b.definesAccessor("Setter", spiedName, b.callable),
      b.runs("PrototypeChain"),
      ...b.ownPropertyTraps,
    ],
  },
  implementation: b.generic,
} satisfies b.FunctionField;

const moduleCache = b.builtin("%ModuleCache%");
const moduleExtensions = b.builtin("%ModuleExtensions%");
const moduleObject = b.builtin("%ModuleObject%");
const bytes = b.union(
  b.instance("TypedArray"),
  b.instance("DataView"),
  b.instance("ArrayBuffer"),
  b.instance("SharedArrayBuffer"),
);

const changesOnItsOwn = { mutability: "ChangesOnItsOwn" } satisfies b.EntryColumns;

const constantUnlessWritten = { mutability: "ConstantUnlessWritten" } satisfies b.EntryColumns;

// A require function finds these three on the object above it. The table lists them under both.
const inheritedByRequire = {
  cache: b.property(moduleCache, changesOnItsOwn),
  main: {
    getter: b.union(moduleObject, b.undefined),
    capability: "js",
    uses: { this: b.inspected },
    implementation: b.generic,
  },
  extensions: b.property(moduleExtensions, changesOnItsOwn),
} satisfies Record<string, b.Field>;

// INIT_NATIVE_MODULE (src/jsc/modules/_NativeModule.h) makes the object that require() answers with constructEmptyObject.
const objectsMadeByNativeModuleMacro: readonly b.BuiltinPath[] = [
  "bun:jsc",
  "node:buffer",
  "node:constants",
  "node:sqlite",
  "node:string_decoder",
  "node:util/types",
];

export default b.declarations(
  b.namespace("%ModuleCache%", {}),
  b.namespace("%ModuleExtensions%", {}),
  b.namespace("%ModuleRequire%", { resolve: resolvesFromModule, ...inheritedByRequire }, { scope: "Module" }),
  b.fn("%ModuleRequire%", loadsModule),
  // RequireFunctionPrototype in src/jsc/bindings/JSCommonJSModule.cpp.
  b.namespace(
    "%ModuleRequirePrototype%",
    { resolve: resolvesFromReceiver, ...inheritedByRequire },
    { listsAllMembers: true },
  ),
  b.inherits("%ModuleRequirePrototype%", "Function.prototype"),
  b.inherits("%ModuleRequire%", "%ModuleRequirePrototype%"),
  b.namespace(
    "%ModuleObject%",
    {
      // The record of the module has these four.
      id: b.property(b.string, constantUnlessWritten),
      filename: b.property(b.string, constantUnlessWritten),
      path: b.property(b.string, constantUnlessWritten),
      loaded: b.property(b.bool, constantUnlessWritten),
      paths: b.property(b.any),
      // The graph of requests says which module objects these two lead to.
      parent: b.property(b.union(moduleObject, b.null)),
      children: b.property(b.union(b.instance("Array").holding({ element: moduleObject }), b.undefined)),
    },
    { scope: "Module" },
  ),
  b.namespace("%ModuleObject%.exports", {}, { scope: "Module", listsAllMembers: true }),
  b.inherits("%ModuleObject%.exports", "Object.prototype"),
  b.namespace(
    "%ImportMeta%",
    {
      url: b.property(b.string),
      dir: b.property(b.string),
      dirname: b.property(b.string),
      file: b.property(b.string),
      filename: b.property(b.string),
      path: b.property(b.string),
      main: b.property(b.bool),
      env: b.property(b.object, { uses: { this: [b.returnedFrom(environmentCell)] } }),
      hot: b.property(b.undefined),
      resolve: resolvesFromImportMeta(b.string.loose),
      resolveSync: resolvesFromImportMeta(b.string.loose.refusing(b.null)),
      "@@toStringTag": b.property(b.string),
    },
    // ImportMetaObjectPrototypeValues in ImportMetaObject.cpp.
    { scope: "Module", listsAllMembers: true },
  ),
  // A lookup goes on there. Object.getPrototypeOf() answers null.
  b.inherits("%ImportMeta%", "Object.prototype"),
  b.same("%ImportMeta%.require", "%ModuleRequire%"),
  b.same("%ModuleObject%.require", "%ModuleRequire%"),
  // Module.prototype stands above every module object. The table does not say so, as the engine's tests expect, and lists here what a lookup finds there.
  b.same("%ModuleObject%.constructor", "node:module"),
  b.same("%ModuleObject%._compile", "node:module.prototype._compile"),
  b.fn("process.getBuiltinModule", {
    args: { id: b.string },
    returns: b.any,
    capability: "js",
    throws: true,
    uses: { id: [b.loadedAsModule] },
    implementation: b.hostCall,
  }),
  b.static("process.mainModule", b.property(b.union(moduleObject, b.undefined))),
  b.class("node:module", {
    hasPrototype: false,
    call: {
      args: { operands: b.any.rest },
      returns: b.undefined,
      capability: "none",
      uses: { operands: b.inspected },
      implementation: b.generic,
    },
    // Nobody else holds the new module: the constructor does not push it into parent.children as Node does. Its own `exports` and `parent` are not listed, so it is not called fresh.
    construct: {
      args: { id: b.any.optional, parent: b.any.optional },
      returns: b.instance("node:module").unaliased,
      capability: "heap",
      throws: true,
      uses: { id: b.inspected, parent: [b.retained] },
      implementation: b.generic,
    },
  }),
  b.same("node:module.Module", "node:module"),
  b.extend("node:module.Module", { mutability: "AlwaysLocked" }),
  b.static("node:module._cache", b.property(moduleCache)),
  b.static("node:module._extensions", b.property(moduleExtensions)),
  // It calls the built-in require on the parent with the request alone, whatever the program has stored in Module.prototype.require.
  b.static("node:module._load", {
    ...loadsModule,
    args: { specifier: b.string, parent: b.any.optional },
    uses: {
      specifier: [b.retained, b.loadedAsModule],
      parent: [b.retained, b.runs("ToPrimitive", b.named("filename"))],
    },
  }),
  // nodeModuleWrapper in NodeModuleModule.cpp keeps nothing: every read calls getWrapperArrayProxy, which makes a proxy of a new array.
  b.static("node:module.wrapper", {
    getter: b.object,
    capability: "js",
    throws: true,
    mutability: "ChangesOnItsOwn",
    implementation: b.generic,
    setter: {
      value: b.any,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { value: [b.runsTransitively("ToPrimitive", b.named("0", "1"))] },
      implementation: b.generic,
    },
  }),
  b.static("node:module.createRequire", {
    args: { filename: b.string.loose },
    returns: b.builtin("%ModuleRequire%"),
    capability: "js",
    throws: true,
    implementation: b.generic,
    mutability: "AlwaysLocked",
  }),
  // No prototype object of a class: once one has escaped, a named store into an object nobody follows counts as a store into it, and such a `holder.require = f` would be a loader function that the program stores.
  b.namespace("node:module.prototype", {
    require: {
      this: b.any,
      args: { specifier: b.any, options: b.any.optional },
      returns: b.any,
      capability: "js",
      throws: true,
      runsUnseenCode: true,
      uses: {
        this: [b.retained, b.runs("ToPrimitive", b.named("filename"))],
        specifier: [b.retained, b.loadedAsModule],
        options: requireOptions,
      },
      implementation: b.generic,
    },
    _compile: compilesText,
    // As in Node, a getter with no setter. It answers the class whatever it is entered with.
    constructor: {
      this: b.any,
      getter: b.union(b.builtin("node:module"), b.object),
      capability: "none" as const,
      uses: { this: b.inspected },
      implementation: b.generic,
    },
  }),
  b.inherits("node:module.prototype", "Object.prototype"),
  objectsMadeByNativeModuleMacro.flatMap(path => b.inherits(path, "Object.prototype")),
  // It looks at a string. For anything else the answer is false.
  b.fn("node:module.isBuiltin", {
    args: { name: b.any.optional },
    returns: b.bool,
    capability: "heap",
    throws: true,
    uses: { name: b.inspected },
    implementation: b.generic,
  }),
  // It converts its operand to a string and puts fixed text around it.
  b.fn("node:module.wrap", {
    args: { script: b.any.optional },
    returns: b.string,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { script: [b.runs("ToPrimitive")] },
    implementation: b.generic,
  }),
  b.fn("node:module.findSourceMap", {
    args: { path: b.any.optional },
    returns: b.union(b.instance("SourceMap"), b.undefined).fresh,
    capability: "heap",
    throws: true,
    uses: { path: b.inspected },
    implementation: b.generic,
  }),
  // The import and require() each get a function of their own.
  b.namespace("utf-8-validate", {}, { scope: "Module" }),
  b.fn("utf-8-validate", {
    args: { buffer: bytes },
    returns: b.bool,
    capability: "heap",
    throws: true,
    uses: { buffer: [b.readsContents()] },
    implementation: b.generic,
  }),
  b.fn("bun:test.spyOn", spyOn),
  b.namespace("bun:test.jest", { spyOn }),
  b.namespace("bun:test.vi", { spyOn }),
  b.fn("bun:test/vitest.spyOn", spyOn),
  b.namespace("bun:test/vitest.jest", { spyOn }),
  b.namespace("bun:test/vitest.vi", { spyOn }),
  b.namespace("bun:test/vitest.vitest", { spyOn }),
  b.namespace("%bun:bundle%", {
    feature: {
      args: { flag: b.string },
      returns: b.bool,
      capability: "none",
      throws: true,
      implementation: b.generic,
    },
  }),
);
