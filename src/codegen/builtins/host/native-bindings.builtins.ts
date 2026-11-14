// The objects that the host answers for `$cpp(file, symbol)`, each from the code of the function of that name. operand-changes.builtins.ts says which binding answers which of the objects whose functions change an operand.
import * as b from "bun-builtins-table";
import { fsOperandUses, heapsOfViews } from "./fs-operands.ts";
import { answering, constructing, retainedByNativeCode } from "./native-code.ts";

const externalState = ["ExternalState"];
const viewHeaps = ["TypedArrayStorage", "TypedArrayElements"];
const operandCodeOnly = { capability: "js", throws: true, runsOnlyOperandCode: true } as const;
const converted = [b.runs("ToPrimitive")];

// An ordinary object that the host makes for the module that asks, with native functions of its own.
const bagOfFunctions = (path: b.BuiltinPath, members: Readonly<Record<string, b.Field>>) => [
  ...b.namespace(path, members, { scope: "Module", listsAllMembers: true }),
  ...b.inherits(path, "Object.prototype"),
];

const answers = (binding: b.BuiltinPath, answer: b.TableType) =>
  b.static(binding, { getter: answer, capability: "heap", implementation: b.generic });

const isNoFunction = {
  returns: b.never,
  capability: "heap",
  throws: true,
  implementation: b.generic,
} satisfies b.FunctionField;

const ttyFunctions = "%BunTTYFunctions%";
const httpFunctions = "%NodeHTTPInternalBinding%";
const mimeClasses = "%MIMEBinding%";
const vmBinding = "%NodeVMBinding%";
const undeclaredFunction = b.otherwiseBy(b.generic);
// The three functions lie in an array. No object stands for the holder, and each has the name that native code gives the function.
const urlFunctions = "%NodeURLFunctions%";

const convertsDomain = {
  ...operandCodeOnly,
  args: { domain: b.string.loose.optional },
  returns: b.string,
  implementation: b.generic,
} satisfies b.FunctionField;

// Native code keeps the server's flags and limits. It finds the server behind the wrapper, and throws for anything else.
// It reads its operands without asking how many were passed.
const configuresServer = (operands: Readonly<Record<string, readonly b.UseSpec[]>>) =>
  ({
    args: Object.fromEntries(Object.keys(operands).map(name => [name, b.any])),
    returns: b.undefined,
    capability: "js",
    throws: true,
    uses: operands,
    writes: externalState,
    implementation: b.generic,
  }) satisfies b.FunctionField;

// The options of a node:fs operation decide the type of its result (args::*::from_js in node_fs.rs).
const parsesFsOptions = (args: Readonly<Record<string, b.TableType>>, returns: b.TableType) =>
  ({
    ...operandCodeOnly,
    args,
    returns,
    uses: Object.fromEntries(Object.keys(args).map(name => [name, fsOperandUses])),
    reads: heapsOfViews,
    writes: heapsOfViews,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;
const withoutFsOptions = (returns: b.TableType) => ({
  ...parsesFsOptions({ path: b.any, options: b.notPassed }, returns),
  isSpecialCase: true,
});
const fsSyncFunction = (
  name: string,
  returns: b.TableType,
  ...specialCases: readonly (b.FunctionField & { isSpecialCase: boolean })[]
) =>
  b.static(`native:Bindgen:node_fs_binding.bind.ts:${name}`, [
    ...specialCases,
    parsesFsOptions({ operands: b.any.rest }, returns),
  ]);
const statsIfFound = b.union(b.instance("Stats"), b.instance("BigIntStats"), b.undefined).fresh;
const stringEncodings = b.enumeration([
  "ascii",
  "base64",
  "base64url",
  "binary",
  "hex",
  "latin1",
  "ucs-2",
  "ucs2",
  "utf-16le",
  "utf-8",
  "utf16-le",
  "utf16le",
  "utf8",
]);

export default b.declarations(
  fsSyncFunction("lstatSync", statsIfFound, withoutFsOptions(b.instance("Stats").fresh)),
  fsSyncFunction(
    "readdirSync",
    b.instance("Array").holding({ element: b.union(b.string, b.instance("Buffer"), b.instance("Dirent")).fresh }).fresh,
    withoutFsOptions(b.instance("Array").holding({ element: b.string }).fresh),
  ),
  fsSyncFunction("readFileSync", b.union(b.string, b.instance("Buffer")).fresh, {
    ...parsesFsOptions({ path: b.any, encoding: stringEncodings, others: b.any.rest }, b.string),
    isSpecialCase: true,
  }),
  fsSyncFunction("statSync", statsIfFound, withoutFsOptions(b.instance("Stats").fresh)),

  bagOfFunctions(ttyFunctions, {
    isatty: {
      ...operandCodeOnly,
      args: { fd: b.any.optional },
      returns: b.bool,
      uses: { fd: converted },
      reads: externalState,
      implementation: b.generic,
    },
    // On Windows it takes a flag alone. Elsewhere the bytes hold the mode the terminal had before.
    setRawMode: {
      ...operandCodeOnly,
      args: { fd: b.any.optional, mode: b.any.optional, state: b.any.optional },
      returns: b.f64,
      uses: { fd: b.inspected, mode: converted, state: [b.readsContents(), b.writesContents()] },
      reads: [...viewHeaps, ...externalState],
      writes: ["TypedArrayElements", ...externalState],
      implementation: b.generic,
    },
    // It defines the columns and the rows as the first two elements of the array, which it refuses if it is shorter. Given a descriptor it reads the array without asking whether one was passed.
    getWindowSize: {
      ...operandCodeOnly,
      args: { fd: b.any, size: b.any },
      returns: b.bool,
      uses: { fd: converted, size: [b.readsContents(), b.writesContents(), b.storedByKey(b.indexKeys, b.f64)] },
      reads: externalState,
      implementation: b.generic,
    },
    rawModeStateSize: b.property(b.f64),
  }),
  // The function is called ttySetMode, so only its native code tells that it is this one.
  b.extend(`${ttyFunctions}.setRawMode`, {
    functionObjectCode: { symbol: "Bun::jsTTYSetMode", header: "ProcessBindingTTYWrap.h" },
    length: 0,
  }),
  bagOfFunctions(httpFunctions, {
    // The two callbacks are called for each client error and each connection.
    setServerCustomOptions: configuresServer({
      server: retainedByNativeCode,
      requireHostHeader: b.inspected,
      useStrictMethodValidation: b.inspected,
      lenientHttpFlags: converted,
      maxHeaderSize: converted,
      onClientError: retainedByNativeCode,
      onConnection: retainedByNativeCode,
      httpAllowHalfOpen: b.inspected,
    }),
    setServerAppFlags: configuresServer({
      server: retainedByNativeCode,
      requireHostHeader: b.inspected,
      useStrictMethodValidation: b.inspected,
      lenientHttpFlags: converted,
      httpAllowHalfOpen: b.inspected,
    }),
    setServerMaxHeadersCount: configuresServer({ server: retainedByNativeCode, maxHeadersCount: converted }),
    drainMicrotasks: { returns: b.undefined, capability: "js", throws: true, implementation: b.generic },
  }),
  answers("native:Cpp:NodeHTTP.cpp:createNodeHTTPInternalBinding", b.builtin(httpFunctions)),

  b.namespace(
    urlFunctions,
    { domainToAscii: convertsDomain, domainToUnicode: convertsDomain, idnaToASCII: convertsDomain },
    { scope: "Module", listsAllMembers: true },
  ),
  b.tuple(
    "NodeURLBinding",
    ["domainToAscii", "domainToUnicode", "idnaToASCII"].map(name => b.builtin(`${urlFunctions}.${name}`)),
  ),

  // The constructors of two classes, which node:util exports. JSMIMEParams.cpp, JSMIMEType.cpp: each makes an instance of its class, below what `prototype` of new.target holds, and throws where it is called without `new`.
  // Of the members of the instances the table says nothing.
  bagOfFunctions(mimeClasses, {}),
  ["MIMEParams", "MIMEType"].flatMap(name =>
    b.class(`${mimeClasses}.${name}`, {
      hasPrototype: false,
      call: isNoFunction,
      construct: constructing(b.instance(`MIMEBinding.${name}`), b.hostCall),
    }),
  ),
  // createJSMIMEBinding(): an object with the two constructors: a call of it throws.
  b.static("native:Cpp:JSMIMEParams.cpp:createJSMIMEBinding", {
    getter: b.builtin(mimeClasses),
    capability: "heap",
    implementation: b.generic,
    call: isNoFunction,
  }),
  b.seenCodeOnly({ holders: [mimeClasses] }),

  // src/jsc/bindings/NodeVM.cpp. unseen-code.builtins.ts and runtime-dependencies.builtins.ts say which of them evaluate a text and start a realm.
  bagOfFunctions(vmBinding, {
    createContext: undeclaredFunction,
    isContext: answering(b.bool),
    compileFunction: undeclaredFunction,
    isModuleNamespaceObject: answering(b.bool),
    kLinked: b.property(b.f64),
    kEvaluated: b.property(b.f64),
    kErrored: b.property(b.f64),
    DONT_CONTEXTIFY: b.property(b.symbol),
    USE_MAIN_CONTEXT_DEFAULT_LOADER: b.property(b.symbol),
  }),
  ["Script", "Module"].flatMap(name => b.class(`${vmBinding}.${name}`, { hasPrototype: false })),
  answers("native:Cpp:NodeVM.cpp:Bun::createNodeVMBinding", b.builtin(vmBinding)),

  // Whether the process was started with --experimental-stream-iter.
  answers("native:Cpp:NodeModuleModule.cpp:createStreamIterEnabledFlag", b.bool),
  // binding() in src/runtime/node/node_fs_binding.rs makes an object for each module that asks. It is no function, and each of its methods has a row of its own: node_fs_binding.bind.ts.
  b.static("native:Bindgen:node_fs_binding.bind.ts:binding", {
    runsUnseenCode: false,
    getter: b.instance("NodeJSFS").fresh,
    capability: "heap",
    implementation: b.generic,
    call: { returns: b.never, capability: "heap", throws: true, implementation: b.generic },
  }),
);
