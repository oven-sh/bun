import * as b from "bun-builtins-table";

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
  this: b.any,
  uses: { this: [b.everything], text: [b.evaluatedAsText, b.loadedAsModule] },
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

const stubbedName = b.keyFrom("name");
// JSMock__jsReplaceProperty (jsJestReplaceProperty) keeps what the data property holds, weakly, and defines or assigns `value` under the name on the object itself.
const replacedName = b.keyFrom("name");
const replaceProperty = {
  args: { object: b.object, name: b.propertyKey.loose, value: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: {
    value: b.inspected,
    object: [
      b.readByKey(replacedName, b.nativeMemory),
      b.definesName(replacedName, b.operand("value")),
      b.deletedByKey(replacedName),
      b.runs("PrototypeChain"),
      ...b.ownPropertyTraps,
    ],
  },
  implementation: b.generic,
} satisfies b.FunctionField;

const stubGlobal = [
  {
    args: { name: b.propertyKey.loose, value: b.any, global: b.builtin("globalThis") },
    returns: b.any,
    capability: "js",
    throws: true,
    uses: {
      value: b.inspected,
      global: [
        b.readByKey(stubbedName, b.nativeMemory),
        b.accessorReadByKey("Getter", stubbedName, b.nativeMemory),
        b.accessorReadByKey("Setter", stubbedName, b.nativeMemory),
        b.definesName(stubbedName, b.operand("value")),
        b.deletedByKey(stubbedName),
        ...b.ownPropertyTraps,
      ],
    },
    implementation: b.generic,
  },
  b.otherwise,
] satisfies readonly b.FunctionField[];

// create_mock_objects() in src/runtime/test_runner/jest.rs and the functions that it calls put these on `jest` and `vi`, beside what has a row of its own below.
// One function lies under the name on both.
const sharedByJestAndVi = [
  "advanceTimersByTime",
  "advanceTimersToNextFrame",
  "advanceTimersToNextTimer",
  "clearAllTimers",
  "getMockedSystemTime",
  "getRealSystemTime",
  "getTimerCount",
  "isFakeTimers",
  "isMockFunction",
  "mocked",
  "resetAllMocks",
  "runAllImmediates",
  "runAllTicks",
  "runAllTimers",
  "runOnlyPendingTimers",
  "setTimerTickMode",
  "useRealTimers",
];

// Each of the two has a function of its own under the name.
const onJestAndOnVi = [
  "advanceTimersByTimeAsync",
  "advanceTimersToNextTimerAsync",
  "doMock",
  "fn",
  "mock",
  "runAllTimersAsync",
  "runOnlyPendingTimersAsync",
  "unmock",
];

const onJestAlone = ["createMockFromModule", "dontMock", "now", "requireActual", "requireMock", "setTimeout"];

const onViAlone = [
  "doUnmock",
  "dynamicImportSettled",
  "hoisted",
  "importActual",
  "importMock",
  "mockObject",
  "resetConfig",
  "setConfig",
  "stubEnv",
  "unstubAllEnvs",
  "unstubAllGlobals",
  "waitFor",
  "waitUntil",
];

// What lies under these on both lies elsewhere in the module too.
const heldElsewhereToo = {
  clearAllMocks: "bun:test.mock.clearAllMocks",
  restoreAllMocks: "bun:test.mock.restore",
  setSystemTime: "bun:test.setSystemTime",
} satisfies Record<string, b.BuiltinPath>;

// The runner keeps the function and calls it when its turn comes, once for each run. It awaits what the function returns and prints what it throws: call_test_callback() in src/runtime/test_runner/bun_test.rs.
// Whatever else stands there names the test or holds its options: BunTestOptions in ScopeFunctions.bind.ts.
const keptByRunner = (passed: Pick<b.CallbackOptions, "args" | "spreadArgs">) => [
  b.retained,
  b.called({
    afterwards: "TouchesOnlyWhatRowNames",
    times: "PerEvent",
    this: b.undefined,
    result: "Escapes",
    ...passed,
  }),
];
// The function that ends the test: a function that the runner has bound.
const passedByJest = keptByRunner({ args: [b.instance("Function").fresh] });
// The context of the test. An around hook of either module gets what it is to run, the context and the suite: step_sequence_one() in src/runtime/test_runner/Execution.rs.
const passedByVitest = keptByRunner({ args: [], spreadArgs: b.any });

// `(description?, callback, options?)`, `(description, options, callback)` or `(callback, options?)`: parse_arguments() in src/runtime/test_runner/bun_test.rs.
const registersWithRunner = (kept: readonly b.UseSpec[]) =>
  ({
    args: { first: b.any.optional, second: b.any.optional, third: b.any.optional },
    capability: "js",
    throws: true,
    uses: { first: kept, second: kept, third: kept },
    implementation: b.generic,
  }) satisfies b.FunctionField;

// create_test_module() in src/runtime/test_runner/jest.rs makes each of these anew for either module.
const scopeFunctionsOfRunner = { test: ["it"], xtest: ["xit"], describe: [], xdescribe: [] } satisfies Record<
  string,
  readonly string[]
>;
const hooksOfRunner = ["beforeAll", "beforeEach", "afterAll", "afterEach", "onTestFinished"];
const aroundHooksOfRunner = ["aroundAll", "aroundEach"];

const functionsOfRunner = (module: b.BuiltinPath, kept: readonly b.UseSpec[]) => [
  ...Object.entries(scopeFunctionsOfRunner).flatMap(([name, otherNames]) => [
    ...b.fn(`${module}.${name}`, registersWithRunner(kept)),
    // bind() in src/runtime/test_runner/ScopeFunctions.rs.
    ...b.inherits(`${module}.${name}`, "%ScopeFunctions%.prototype"),
    ...otherNames.flatMap(other => b.same(`${module}.${other}`, `${module}.${name}`)),
  ]),
  ...hooksOfRunner.flatMap(name => b.fn(`${module}.${name}`, registersWithRunner(kept))),
  ...aroundHooksOfRunner.flatMap(name => b.fn(`${module}.${name}`, registersWithRunner(passedByVitest))),
];

// toMatchObject() and expect.objectContaining(), wherever a matcher meets one, are Bun__deepMatch() in bindings.cpp.
const keptForMatchers = [b.retained, b.privateFieldsCompared];
// The object keeps the value for its matchers, which call it where it is a function.
const expects = {
  args: { value: b.any.optional, message: b.any.optional },
  returns: b.instance("Expect").fresh,
  capability: "js",
  throws: true,
  uses: { value: keptForMatchers, message: [b.retained] },
  implementation: b.generic,
} satisfies b.FunctionField;

// The matcher that it answers keeps the pattern, and wherever a comparison meets the matcher the pattern goes to Bun__deepMatch().
const answersMatcherOfPattern = {
  args: { pattern: b.any.optional, others: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { this: [b.everything], pattern: [b.everything, b.privateFieldsCompared], others: b.inspected },
  implementation: b.generic,
} satisfies b.FunctionField;

// src/runtime/test_runner/expect.bind.ts. A matcher reads what its object holds, which expect() has kept, and hands the object itself to nobody.
// Behind `.resolves`, `.rejects` and expect.poll() it answers a promise.
const matches = (returns: b.TableType, receiver: readonly b.UseSpec[]) =>
  ({
    args: { expected: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { this: receiver, expected: keptForMatchers },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

// prettier-ignore
const matchers = [
  "fail", "lastCalledWith", "lastReturnedWith", "nthCalledWith", "nthReturnedWith", "pass", "toBe", "toBeArray",
  "toBeArrayOfSize", "toBeBoolean", "toBeCalled", "toBeCalledTimes", "toBeCalledWith", "toBeCloseTo", "toBeDate",
  "toBeDefined", "toBeEmpty", "toBeEven", "toBeFalse", "toBeFalsy", "toBeFinite", "toBeFunction", "toBeGreaterThan",
  "toBeGreaterThanOrEqual", "toBeInstanceOf", "toBeInteger", "toBeLessThan", "toBeLessThanOrEqual", "toBeNaN",
  "toBeNegative", "toBeNil", "toBeNull", "toBeNumber", "toBeOdd", "toBeOneOf", "toBePositive", "toBeString",
  "toBeSymbol", "toBeTrue", "toBeTruthy", "toBeTypeOf", "toBeUndefined", "toBeWithin", "toContain", "toEndWith",
  "toEqual", "toEqualIgnoringWhitespace", "toHaveBeenCalled", "toHaveBeenCalledAfter", "toHaveBeenCalledBefore",
  "toHaveBeenCalledExactlyOnceWith", "toHaveBeenCalledOnce", "toHaveBeenCalledTimes", "toHaveBeenCalledWith",
  "toHaveBeenLastCalledWith", "toHaveBeenNthCalledWith", "toHaveLastResolvedWith", "toHaveLastReturnedWith",
  "toHaveLength", "toHaveNthResolvedWith", "toHaveNthReturnedWith", "toHaveProperty", "toHaveResolved",
  "toHaveResolvedTimes", "toHaveResolvedWith", "toHaveReturned", "toHaveReturnedTimes", "toHaveReturnedWith",
  "toInclude", "toIncludeRepeated", "toMatch", "toMatchFileSnapshot", "toMatchInlineSnapshot", "toMatchObject",
  "toMatchSnapshot", "toReturn", "toSatisfy", "toStartWith", "toStrictEqual", "toThrow", "toThrowError",
  "toThrowErrorMatchingInlineSnapshot", "toThrowErrorMatchingSnapshot",
];
// prettier-ignore
const matchersAnsweringTheirObject = [
  "toBeEmptyObject", "toBeObject", "toBeValidDate", "toContainAllKeys", "toContainAllValues", "toContainAnyKeys",
  "toContainAnyValues", "toContainEqual", "toContainKey", "toContainKeys", "toContainValue", "toContainValues",
];

const undeclaredFunctions = (holder: b.BuiltinPath, names: readonly string[]) =>
  names.flatMap(name => b.fn(`${holder}.${name}`, b.otherwise));

const sameMembers = (holder: b.BuiltinPath, original: b.BuiltinPath, names: readonly string[]) =>
  names.flatMap(name => b.same(`${holder}.${name}`, `${original}.${name}`));

const moduleCache = b.builtin("%ModuleCache%");
const moduleExtensions = b.builtin("%ModuleExtensions%");
const moduleObject = b.builtin("%ModuleObject%");
const bytes = b.union(
  b.instance("TypedArray"),
  b.instance("DataView"),
  b.instance("ArrayBuffer"),
  b.instance("SharedArrayBuffer"),
);

const externalState = ["ExternalState"];

// It returns undefined and looks at nothing.
const doesNothing = {
  args: { operands: b.any.rest },
  returns: b.undefined,
  capability: "none",
  uses: { operands: b.inspected },
  implementation: b.generic,
} satisfies b.FunctionField;

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
      _compile: compilesText,
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
      // process.env's object, but under `bun test`: there an object of its own, ImportMetaEnv.cpp, in which DEV, PROD and SSR are booleans.
      env: b.property(b.object),
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
  b.membersFrom("node:module", b.staticTable("src/jsc/modules/NodeModuleModule.cpp", "nodeModuleObjectTable")),
  b.same("node:module.Module", "node:module"),
  b.extend("node:module.Module", { mutability: "AlwaysLocked" }),
  // The setter of each keeps what is stored and the getter answers it, so both read and write as a property does: followStoredLoaderFunctionsOfCommonJS() in AOTFlowRulesCommonJS.cpp finds what the program has stored in the cell.
  b.static("node:module._resolveFilename", b.property(b.any)),
  b.static("node:module.runMain", b.property(b.any)),
  b.static("node:module._cache", b.property(moduleCache)),
  b.static("node:module._extensions", b.property(moduleExtensions)),
  // It returns undefined and converts nothing.
  b.static("node:module._load", { ...loadsModule, readsStateBeforeConversions: true }),
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
    uses: { filename: [b.printedByFormatter("constructor")] },
    implementation: b.generic,
    mutability: "AlwaysLocked",
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
  // It looks at a string. For anything else the answer is false.
  b.fn("node:module.isBuiltin", {
    args: { name: b.any.optional },
    returns: b.bool,
    capability: "heap",
    throws: true,
    uses: { name: b.inspected },
    implementation: b.generic,
  }),
  ["_preloadModules", "register", "syncBuiltinESMExports"].flatMap(name => b.fn(`node:module.${name}`, doesNothing)),
  b.fn("node:module.enableCompileCache", {
    args: { options: b.any.optional },
    returns: b.plainData.fresh,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { options: b.optionBag(["directory", "portable"]) },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }),
  b.fn("node:module.flushCompileCache", {
    returns: b.undefined,
    capability: "heap",
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }),
  b.fn("node:module.getCompileCacheDir", {
    returns: b.union(b.string, b.undefined),
    capability: "heap",
    reads: externalState,
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
  functionsOfRunner("bun:test", passedByJest),
  functionsOfRunner("bun:test/vitest", passedByVitest),
  b.fn("bun:test.spyOn", spyOn),
  b.namespace("bun:test.jest", { spyOn, replaceProperty, resetModules: b.otherwise, useFakeTimers: b.otherwise }),
  b.namespace("bun:test.vi", { spyOn, resetModules: b.otherwise, useFakeTimers: b.otherwise, stubGlobal }),
  b.fn("bun:test/vitest.spyOn", spyOn),
  b.namespace("bun:test/vitest.vi", {
    spyOn,
    resetModules: b.otherwise,
    useFakeTimers: b.otherwise,
    stubGlobal,
  }),
  // One object under two names: Bun__Jest__createTestModuleObject() in src/runtime/test_runner/jest.rs.
  b.same("bun:test/vitest.vitest", "bun:test/vitest.vi"),
  // The export is the constructor of the class: create_test_module() and create_mock_objects() in src/runtime/test_runner/jest.rs.
  b.callOfConstructor("%Expect%", expects),
  b.fn("%Expect%.objectContaining", answersMatcherOfPattern),
  b.method("%ExpectStatic%.prototype.objectContaining", answersMatcherOfPattern),
  matchers.flatMap(name =>
    b.method(`%Expect%.prototype.${name}`, matches(b.union(b.undefined, b.instance("Promise").fresh), b.inspected)),
  ),
  // Each notes the word in the object and answers the object.
  ["not", "resolves", "rejects"].flatMap(name =>
    b.method(`%Expect%.prototype.${name}`, {
      getter: b.instance("Expect"),
      capability: "heap",
      throws: true,
      uses: { this: [b.returned] },
      implementation: b.hostCall,
    }),
  ),
  matchersAnsweringTheirObject.flatMap(name =>
    b.method(
      `%Expect%.prototype.${name}`,
      matches(b.union(b.undefined, b.instance("Promise"), b.instance("Expect")), [b.returned]),
    ),
  ),
  b.same("bun:test.expect", "%Expect%"),
  b.same("bun:test/vitest.expect", "%Expect%"),
  b.fn("bun:test.setSystemTime", b.otherwise),
  b.namespace("bun:test.mock", { module: b.otherwise, restore: b.otherwise, clearAllMocks: b.otherwise }),
  b.fn("bun:test.mock", b.otherwise),
  undeclaredFunctions("bun:test.jest", [...sharedByJestAndVi, ...onJestAndOnVi, ...onJestAlone]),
  undeclaredFunctions("bun:test.vi", [...onJestAndOnVi, ...onViAlone]),
  sameMembers("bun:test.vi", "bun:test.jest", sharedByJestAndVi),
  ["bun:test.jest", "bun:test.vi"].flatMap(holder =>
    Object.entries(heldElsewhereToo).flatMap(([name, original]) => b.same(`${holder}.${name}`, original)),
  ),
  // The module starts as a copy of bun:test, and its `vi` as a copy of that `vi`.
  b.same("bun:test/vitest.mock", "bun:test.mock"),
  b.same("bun:test/vitest.setSystemTime", "bun:test.setSystemTime"),
  b.same("bun:test/vitest.jest", "bun:test.jest"),
  sameMembers("bun:test/vitest.vi", "bun:test.vi", [
    ...sharedByJestAndVi,
    ...onJestAndOnVi,
    ...onViAlone,
    ...Object.keys(heldElsewhereToo),
  ]),
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
