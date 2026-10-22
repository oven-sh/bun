import * as b from "bun-builtins-table";
import { environmentCell } from "./native-cells.ts";

const pathListRead = b.runsTransitively("OwnValues", "PrototypeChain", b.named("paths"));

// A Module._resolveFilename that the program has replaced is called with the options.
const resolveOptions = [b.retained, pathListRead];
const requireOptions = [b.retained, b.runsTransitively("OwnValues", "PrototypeChain", b.named("paths", "type"))];

const loadsModule = {
  args: { specifier: b.string.loose, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained, b.loadedAsModule], options: requireOptions },
  implementation: b.generic,
} satisfies b.FunctionField;

const compilesText = {
  args: { text: b.string.loose, filename: b.string.loose },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { text: [b.evaluatedAsText] },
  implementation: b.generic,
} satisfies b.FunctionField;

const resolvesFromModule = {
  args: { specifier: b.string.loose, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained], options: resolveOptions },
  implementation: b.generic,
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

const spyOn = {
  args: { object: b.object, method: b.propertyKey.loose },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { object: [b.everything, b.definesName(b.keyFrom("method"), b.callable)] },
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
  b.namespace(
    "%ModuleRequire%",
    {
      resolve: resolvesFromModule,
      cache: b.property(moduleCache, changesOnItsOwn),
      main: {
        getter: b.union(moduleObject, b.undefined),
        capability: "js",
        uses: { this: b.inspected },
        implementation: b.generic,
      },
      extensions: b.property(moduleExtensions, changesOnItsOwn),
    },
    { scope: "Module" },
  ),
  b.fn("%ModuleRequire%", loadsModule),
  b.namespace(
    "%ModuleObject%",
    {
      _compile: compilesText,
      // The record of the module has these four.
      id: b.property(b.string, constantUnlessWritten),
      filename: b.property(b.string, constantUnlessWritten),
      path: b.property(b.string, constantUnlessWritten),
      loaded: b.property(b.bool, constantUnlessWritten),
      paths: b.property(b.any),
      // The graph of requests says which module objects these two lead to. To whoever has come to the object in a way that the build did not follow they are undefined.
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
    },
    { scope: "Module" },
  ),
  b.same("%ImportMeta%.require", "%ModuleRequire%"),
  b.same("%ModuleObject%.require", "%ModuleRequire%"),
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
    construct: {
      args: { id: b.any.optional, parent: b.any.optional },
      returns: moduleObject,
      capability: "heap",
      throws: true,
      uses: { id: b.inspected, parent: [b.retained] },
      implementation: b.generic,
    },
  }),
  b.same("node:module.Module", "node:module"),
  b.static("node:module._cache", b.property(moduleCache)),
  b.static("node:module._extensions", b.property(moduleExtensions)),
  b.static("node:module._load", loadsModule),
  b.static("node:module.wrapper", b.property(b.object)),
  b.static("node:module.createRequire", {
    args: { filename: b.string.loose },
    returns: b.builtin("%ModuleRequire%"),
    capability: "js",
    throws: true,
    implementation: b.generic,
  }),
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
  }),
  b.inherits("node:module.prototype", "Object.prototype"),
  objectsMadeByNativeModuleMacro.flatMap(path => b.inherits(path, "Object.prototype")),
  b.fn("node:module.findSourceMap", {
    args: { path: b.any.optional },
    returns: b.union(b.instance("SourceMap"), b.undefined).fresh,
    capability: "heap",
    throws: true,
    uses: { path: b.inspected },
    implementation: b.generic,
  }),
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
  // The text that goes around the source text of a CommonJS module. A compiled module has none, so a program may replace it.
  b.extend("node:module.wrapper", constantUnlessWritten),
  b.namespace("%bun:bundle%", {
    feature: {
      args: { flag: b.string },
      returns: b.bool,
      capability: "none",
      throws: true,
      implementation: b.generic,
    },
    validate: {
      args: { value: b.any },
      returns: b.any,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: {
        value: [
          b.returned,
          b.runsTransitively(
            "OwnKeys",
            "OwnValues",
            "Iterate",
            "PrototypeChain",
            "ToPrimitive",
            b.named("length"),
            b.calls("startsWith", "endsWith", "indexOf", "slice"),
          ),
          b.reachableValuesStoredIn(b.result),
        ],
      },
      typedResultForm: { form: "ValidatedValue", source: "value" },
      implementation: b.compiled("prelude/validation", "validate"),
    },
  }),
);
