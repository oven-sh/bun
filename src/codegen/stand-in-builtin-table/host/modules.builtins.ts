import * as b from "bun-builtins-table";

const requireOptions = [b.retained, b.runsTransitively("OwnValues", "PrototypeChain", b.named("paths", "type"))];

const loadsModule = {
  args: { specifier: b.string, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained, b.loadedAsModule], options: requireOptions },
  implementation: b.generic,
} satisfies b.FunctionField;

const resolvesFromModule = {
  args: { specifier: b.string, options: b.any.optional },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { specifier: [b.retained], options: [b.retained] },
  implementation: b.generic,
} satisfies b.FunctionField;

const moduleCache = b.builtin("%ModuleCache%");
const moduleExtensions = b.builtin("%ModuleExtensions%");
const moduleObject = b.builtin("%ModuleObject%");
const changesOnItsOwn = { mutability: "ChangesOnItsOwn" } satisfies b.EntryColumns;
const constantUnlessWritten = { mutability: "ConstantUnlessWritten" } satisfies b.EntryColumns;

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
      id: b.property(b.string, constantUnlessWritten),
      filename: b.property(b.string, constantUnlessWritten),
      path: b.property(b.string, constantUnlessWritten),
      loaded: b.property(b.bool, constantUnlessWritten),
      paths: b.property(b.any),
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
    },
    { scope: "Module" },
  ),
  b.same("%ImportMeta%.require", "%ModuleRequire%"),
  b.same("%ModuleObject%.require", "%ModuleRequire%"),
  b.namespace("process", {
    getBuiltinModule: {
      args: { id: b.string },
      returns: b.any,
      capability: "js",
      throws: true,
      uses: { id: [b.loadedAsModule] },
      implementation: b.hostCall,
    },
    mainModule: b.property(b.union(moduleObject, b.undefined)),
    dlopen: {
      args: { module: b.any.optional, filename: b.any.optional },
      returns: b.any,
      capability: "js",
      throws: true,
      loadsMachineCodeAs: "process.dlopen",
      uses: { module: [b.everything], filename: [b.runs("ToPrimitive")] },
      implementation: b.hostCall,
    },
  }),
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
  b.static("node:module._cache", b.property(moduleCache)),
  b.static("node:module._extensions", b.property(moduleExtensions)),
  b.static("node:module._load", { ...loadsModule, readsStateBeforeConversions: true }),
  b.static("node:module.createRequire", {
    args: { filename: b.string.loose },
    returns: b.builtin("%ModuleRequire%"),
    capability: "js",
    throws: true,
    implementation: b.generic,
  }),
);
