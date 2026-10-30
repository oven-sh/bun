import * as b from "bun-builtins-table";

type Contents = Readonly<Record<string, b.TableType>>;

interface BodyForm {
  body: b.TableType;
  uses: readonly b.UseSpec[];
}

const externalState = ["ExternalState"];
const operandHeaps = ["TypedArrayStorage", "TypedArrayElements", ...externalState];

const nativeOnly = { capability: "heap", throws: true, implementation: b.hostCall } as const;
const operandCodeOnly = {
  capability: "js",
  runsOnlyOperandCode: true,
  throws: true,
  implementation: b.hostCall,
} as const;
// A body may be a stream that the program made. Reading or teeing it runs the functions the stream was made with.
const anyCode = { capability: "js", throws: true, implementation: b.hostCall } as const;

const primitiveOrAbsent = b.primitiveValue.optional;
const anythingOrAbsent = b.any.optional;
const typedArrayOrBuffer = b.union(
  b.instance("TypedArray"),
  b.instance("ArrayBuffer"),
  b.instance("SharedArrayBuffer"),
);
const bytes = b.union(typedArrayOrBuffer, b.instance("DataView"));
const urlText = b.union(b.primitiveValue, b.instance("URL"));
const parsedJSON = b.union(b.plainData, b.strictNull, b.bool, b.f64, b.string);

// The native constructor is handed the object before it is complete.
const newResponse = b.instance("Response").fresh;
const constructedResponse = newResponse;
const constructedRequest = b.instance("Request").fresh;
// The bytes may belong to an S3File, and then the new object is one.
const newBlobOverSameBytes = b.union(b.instance("Blob"), b.instance("S3File")).fresh;

const newPromiseHolding = (contents: Contents) => b.instance("Promise").holding(contents).fresh;
// The reason is what a stream of the program fails with, or an error that native code makes: one about a file has `code`, `errno`, `path` and `syscall` of its own.
const settledWithAnyReason = (value: b.TableType) => newPromiseHolding({ value, reason: b.any });

const stateRead = [b.readsContents()];
const stateUpdate = [b.readsContents(), b.writesContents()];
const keptStream = [b.retained, b.readsContents()];
const converted = [b.readsContents(), b.runs("ToPrimitive")];
const serialized = [b.runsTransitively("OwnKeys", "OwnValues", "ToJSON", "ToPrimitive")];
const membersInspected = (...names: readonly string[]) => [b.runs(b.named(...names)), b.membersOnlyInspected];

// Headers are a Headers object, an iterable of iterable pairs or a record, and every name and value is converted.
const headerProtocols = ["OwnKeys", "OwnValues", "PrototypeChain", "Iterate", "ToPrimitive"] as const;

const responseOptionNames = ["headers", "status", "statusText", "method"];
const responseOptions = [
  b.readsContents(),
  b.runsTransitively(...headerProtocols, b.named(...responseOptionNames)),
  b.membersOfObjectsOnly,
];

// An async generator function is called, and any other object is asked for @@asyncIterator, inside the call.
const bodyOfAnyKind = [
  b.retained,
  b.reachableValuesStoredIn(b.nativeMemory),
  b.readsContents(),
  b.writesContents(),
  b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "Once", this: b.undefined, args: [], result: "Escapes" }),
  b.runsTransitively(
    "OwnValues",
    "PrototypeChain",
    "ToPrimitive",
    b.named("length", "next"),
    b.calls("@@asyncIterator"),
  ),
];

// The members of ResponseInit are among them: a status outside the range of a response makes the constructor throw.
const requestOptionNames = [
  "body",
  "cache",
  "headers",
  "keepalive",
  "method",
  "mode",
  "redirect",
  "signal",
  "status",
  "statusText",
  "url",
];

// The signal and the body are kept. The body is used like the body of a response.
const requestOptions = [
  b.reachableValuesStoredIn(b.nativeMemory),
  b.readsContents(),
  b.writesContents(),
  b.runsTransitively(...headerProtocols, b.named(...requestOptionNames, "length", "next"), b.calls("@@asyncIterator")),
  b.membersOfObjectsOnly,
];

// The bytes are copied, or the native store behind them is shared.
const copiedBody = b.union(typedArrayOrBuffer, b.instance("Blob"), b.instance("URLSearchParams"));

const bodyFormsWithoutCode: readonly BodyForm[] = [
  { body: primitiveOrAbsent, uses: b.inspected },
  { body: copiedBody, uses: stateRead },
  { body: b.instance("ReadableStream"), uses: keptStream },
];

// The options are read before the body, so no operand is converted ahead of the call.
const responseConstruction = [
  ...bodyFormsWithoutCode.map(({ body, uses }) => ({
    ...nativeOnly,
    args: { body, init: primitiveOrAbsent },
    returns: constructedResponse,
    uses: { body: uses },
    reads: externalState,
  })),
  ...bodyFormsWithoutCode.map(({ body, uses }) => ({
    ...operandCodeOnly,
    args: { body, init: anythingOrAbsent },
    returns: constructedResponse,
    uses: { body: uses, init: responseOptions },
    reads: externalState,
  })),
  {
    ...operandCodeOnly,
    args: { body: anythingOrAbsent, init: anythingOrAbsent },
    returns: constructedResponse,
    uses: { body: bodyOfAnyKind, init: responseOptions },
    reads: operandHeaps,
    writes: externalState,
  },
] satisfies b.FunctionField[];

// The members of a ResponseInit literal that compiled code has taken apart, in the order in which the functions below take them.
const responseInitParts = ["status", "statusText", "headers"];
const usesOfResponseInitParts = {
  status: [b.runs("ToPrimitive")],
  statusText: [b.runs("ToPrimitive")],
  headers: [b.readsContents(), b.runsTransitively(...headerProtocols), b.membersOfObjectsOnly],
};
const argsOfResponseInitParts = { status: b.any, statusText: b.any, headers: b.any };

const entryTakingResponseInitParts = (symbol: string) => {
  const value = { value: "Value", cppType: "JSC::EncodedJSValue" } as const;
  return {
    symbol,
    declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue ${symbol}(JSC::JSGlobalObject*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);`,
    headers: [],
    parameters: [{ value: "Realm", cppType: "JSC::JSGlobalObject*" }, value, value, value, value],
  } satisfies b.DirectEntrySpec;
};

// Every operand is passed.
const responseConstructionFromParts = [
  ...[{ body: b.primitiveValue, uses: b.inspected }, ...bodyFormsWithoutCode.slice(1)].map(({ body, uses }) => ({
    ...operandCodeOnly,
    args: { body, ...argsOfResponseInitParts },
    returns: constructedResponse,
    uses: { body: uses, ...usesOfResponseInitParts },
    reads: externalState,
    directEntry: entryTakingResponseInitParts("Response__createFromParts"),
  })),
  {
    ...operandCodeOnly,
    args: { body: b.any, ...argsOfResponseInitParts },
    returns: constructedResponse,
    uses: { body: bodyOfAnyKind, ...usesOfResponseInitParts },
    reads: operandHeaps,
    writes: externalState,
    directEntry: entryTakingResponseInitParts("Response__createFromParts"),
  },
] satisfies b.FunctionField[];

// A call without a value makes an empty body, and a call with undefined throws.
const responseFromJSON = [
  { ...nativeOnly, args: { value: primitiveOrAbsent, init: primitiveOrAbsent }, returns: newResponse },
  {
    ...operandCodeOnly,
    args: { value: anythingOrAbsent, init: primitiveOrAbsent },
    returns: newResponse,
    uses: { value: serialized },
  },
  {
    ...operandCodeOnly,
    args: { value: anythingOrAbsent, init: anythingOrAbsent },
    returns: newResponse,
    uses: { value: serialized, init: responseOptions },
    reads: externalState,
  },
] satisfies b.FunctionField[];

// A call without a URL redirects to the empty string, and a call with undefined to "undefined".
const redirection = [
  { ...nativeOnly, args: { url: b.string.loose.optional, init: primitiveOrAbsent }, returns: newResponse },
  {
    ...operandCodeOnly,
    args: { url: b.string.loose.optional, init: anythingOrAbsent },
    returns: newResponse,
    uses: { init: responseOptions },
    reads: externalState,
  },
] satisfies b.FunctionField[];

// A Request that is the only object among the operands is cloned natively.
const requestConstruction = [
  { ...nativeOnly, args: { input: primitiveOrAbsent, init: primitiveOrAbsent }, returns: constructedRequest },
  {
    ...operandCodeOnly,
    args: { input: b.instance("URL"), init: primitiveOrAbsent },
    returns: constructedRequest,
    uses: { input: converted },
    reads: externalState,
  },
  {
    ...anyCode,
    args: { input: b.instance("Request"), init: primitiveOrAbsent },
    returns: constructedRequest,
    uses: { input: stateUpdate },
    reads: externalState,
    writes: externalState,
  },
  {
    ...anyCode,
    args: { input: urlText, init: b.instance("Request") },
    returns: constructedRequest,
    uses: { input: converted, init: stateUpdate },
    reads: externalState,
    writes: externalState,
  },
  {
    ...anyCode,
    args: { input: urlText, init: b.instance("Response") },
    returns: constructedRequest,
    uses: { input: converted, init: requestOptions },
    reads: operandHeaps,
    writes: externalState,
  },
  {
    ...operandCodeOnly,
    args: { input: urlText.optional, init: anythingOrAbsent },
    returns: constructedRequest,
    uses: { input: converted, init: requestOptions },
    reads: operandHeaps,
    writes: externalState,
  },
  {
    ...anyCode,
    args: { input: anythingOrAbsent, init: anythingOrAbsent },
    returns: constructedRequest,
    uses: { input: requestOptions, init: requestOptions },
    reads: operandHeaps,
    writes: externalState,
  },
] satisfies b.FunctionField[];

const readsBody = (settledValue: b.TableType) =>
  ({
    ...anyCode,
    returns: settledWithAnyReason(settledValue),
    uses: { this: stateUpdate },
    reads: externalState,
    writes: externalState,
  }) satisfies b.FunctionField;

const readsBlob = (settledValue: b.TableType) =>
  ({
    ...nativeOnly,
    returns: settledWithAnyReason(settledValue),
    uses: { this: stateUpdate },
    reads: externalState,
    writes: externalState,
  }) satisfies b.FunctionField;

const parsedBody = { typedResultForm: { form: "ParsedBody", source: "this" } } as const;

// What json() parses: the string that holds the body, the text behind the UTF-16 mark of a Blob, otherwise the bytes.
// The call of json() that this one stands for has matched its receiver, by a test where the type does not say it.
const jsonSourceOfBody = {
  ...anyCode,
  args: { body: b.any },
  returns: settledWithAnyReason(b.union(b.instance("Uint8Array").exactly, b.string).fresh),
  uses: { body: stateUpdate },
  reads: externalState,
  writes: externalState,
  directEntry: {
    symbol: "Body__jsonSource",
    declaration: 'extern "C" SYSV_ABI JSC::EncodedJSValue Body__jsonSource(JSC::JSGlobalObject*, JSC::EncodedJSValue);',
    headers: [],
    parameters: [
      { value: "Realm", cppType: "JSC::JSGlobalObject*" },
      { value: "Value", cppType: "JSC::EncodedJSValue" },
    ],
  },
} satisfies b.FunctionField;

// The bytes of a stream are handed to what `FormData.from` holds, which a program can replace, and a promise that is resolved with a FormData looks for `then` on a prototype that is not locked.
const readsFormData = readsBody(b.any);

const membersOfMessage = (className: string) => ({
  // A stream whose only chunk is a string settles with a Uint8Array.
  arrayBuffer: readsBody(b.union(b.instance("ArrayBuffer"), b.instance("Uint8Array").exactly).fresh),
  blob: readsBody(newBlobOverSameBytes),
  bytes: readsBody(b.instance("Uint8Array").exactly.fresh),
  clone: {
    ...anyCode,
    returns: b.instance(className).fresh,
    uses: { this: stateUpdate },
    reads: externalState,
    writes: externalState,
  },
  formData: readsFormData,
  json: { ...readsBody(parsedJSON), ...parsedBody },
  text: readsBody(b.string),
  textStream: {
    ...anyCode,
    returns: b.instance("ReadableStream").fresh,
    uses: { this: stateUpdate },
    reads: externalState,
    writes: externalState,
  },
});

const partWithoutCode = b.union(b.primitiveValue, bytes, b.instance("Blob"));
// A value that is neither an array nor bytes makes the constructor throw.
const partsWithoutCode = b.union(
  b.primitiveValue,
  bytes,
  b.instance("Array").holding({ element: partWithoutCode }).pristine("Storage"),
).optional;
const joinedParts = [
  b.readsContents(),
  b.runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", b.named("length")),
];
const blobOptions = membersInspected("type");

const blobConstruction = [
  {
    ...nativeOnly,
    args: { parts: partsWithoutCode, options: primitiveOrAbsent },
    returns: b.instance("Blob").fresh,
    uses: { parts: stateRead },
    reads: externalState,
  },
  {
    ...operandCodeOnly,
    args: { parts: partsWithoutCode, options: anythingOrAbsent },
    returns: b.instance("Blob").fresh,
    uses: { parts: stateRead, options: blobOptions },
    reads: externalState,
  },
  {
    ...operandCodeOnly,
    args: { parts: anythingOrAbsent, options: anythingOrAbsent },
    returns: b.instance("Blob").fresh,
    uses: { parts: joinedParts, options: blobOptions },
    reads: operandHeaps,
  },
] satisfies b.FunctionField[];

const s3OptionNames = [
  "accessKeyId",
  "acl",
  "bucket",
  "contentDisposition",
  "contentEncoding",
  "endpoint",
  "pageSize",
  "partSize",
  "queueSize",
  "region",
  "requestPayer",
  "retry",
  "secretAccessKey",
  "sessionToken",
  "storageClass",
  "type",
  "virtualHostedStyle",
];

// The promise for a file descriptor is fulfilled with an error.
const removesFile = {
  ...operandCodeOnly,
  args: { options: anythingOrAbsent },
  returns: settledWithAnyReason(b.union(b.undefined, b.bool, b.instance("Error")).unaliased),
  uses: { this: stateRead, options: b.hostOptionBag(s3OptionNames) },
  reads: externalState,
  writes: externalState,
} satisfies b.FunctionField;

const measuredNumber = {
  getter: b.f64,
  capability: "none",
  uses: { this: stateUpdate },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.GetterField;

const membersOfBlob = {
  arrayBuffer: readsBlob(b.instance("ArrayBuffer").fresh),
  bytes: readsBlob(b.instance("Uint8Array").exactly.fresh),
  delete: removesFile,
  exists: readsBlob(b.bool),
  formData: readsFormData,
  // A file or an S3File is kept, and its `bytes` is called when the image is read.
  image: {
    ...operandCodeOnly,
    args: { options: anythingOrAbsent },
    returns: b.instance("Image").fresh,
    uses: { this: [b.retained, b.readsContents()], options: membersInspected("maxPixels", "autoOrient") },
    reads: externalState,
  },
  json: { ...readsBlob(parsedJSON), ...parsedBody },
  lastModified: measuredNumber,
  // The setter keeps undefined, null or a string and ignores any other value.
  name: {
    getter: b.union(b.string, b.null),
    capability: "heap",
    throws: true,
    uses: { this: stateUpdate },
    reads: externalState,
    writes: externalState,
    implementation: { how: "CachedGetter", cppClass: "JSBlob", member: "m_name" },
    setter: {
      value: b.any,
      capability: "heap",
      throws: true,
      uses: { this: stateUpdate, value: b.inspected },
      reads: externalState,
      writes: externalState,
      implementation: b.hostCall,
    },
  },
  size: measuredNumber,
  // An operand of another kind than a number or a string counts as absent.
  slice: {
    ...nativeOnly,
    args: { start: anythingOrAbsent, end: anythingOrAbsent, contentType: anythingOrAbsent },
    returns: newBlobOverSameBytes,
    uses: { this: stateRead, start: b.inspected, end: b.inspected, contentType: b.inspected },
    reads: externalState,
  },
  // The promise is resolved with a Stats object, which looks for `then` on a prototype that is not locked.
  stat: {
    ...nativeOnly,
    returns: b.union(b.instance("Promise").holding({ value: b.any, reason: b.any }), b.undefined).fresh,
    uses: { this: stateRead },
    reads: externalState,
  },
  // A Blob over a file descriptor answers the same stream at every call.
  stream: {
    ...nativeOnly,
    args: { chunkSize: anythingOrAbsent },
    returns: b.instance("ReadableStream"),
    uses: { this: stateUpdate, chunkSize: b.inspected },
    reads: externalState,
    writes: externalState,
  },
  text: readsBlob(b.string),
  type: {
    getter: b.string,
    capability: "heap",
    uses: { this: stateRead },
    reads: externalState,
    implementation: b.hostCall,
  },
  unlink: removesFile,
  write: [
    {
      ...nativeOnly,
      args: { data: b.union(b.string, bytes), options: primitiveOrAbsent },
      returns: settledWithAnyReason(b.f64),
      uses: { this: stateUpdate, data: stateRead },
      reads: externalState,
      writes: externalState,
    },
    {
      ...anyCode,
      args: { data: anythingOrAbsent, options: anythingOrAbsent },
      returns: settledWithAnyReason(b.any),
      uses: {
        this: stateUpdate,
        data: [
          b.retained,
          b.reachableValuesStoredIn(b.nativeMemory),
          b.readsContents(),
          b.writesContents(),
          b.runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", b.named("length")),
        ],
        options: b.hostOptionBag(["createPath", ...s3OptionNames]),
      },
      reads: operandHeaps,
      writes: externalState,
    },
  ],
  writer: {
    ...operandCodeOnly,
    args: { options: anythingOrAbsent },
    returns: b.union(b.instance("FileSink"), b.instance("NetworkSink")).fresh,
    uses: { this: stateUpdate, options: b.hostOptionBag(["fd", "path", ...s3OptionNames]) },
    reads: externalState,
    writes: externalState,
  },
} satisfies Record<string, b.Field>;

const declareMethods = (className: string, members: Readonly<Record<string, b.Field>>) =>
  Object.entries(members).flatMap(([name, field]) => b.method(`%${className}%.prototype.${name}`, field));

export default b.declarations(
  b.construction("%Response%", responseConstruction),
  b.static("%CompilerHelpers%.newResponseFromParts", responseConstructionFromParts),
  b.extend("%CompilerHelpers%.newResponseFromParts", { runsUnseenCode: false }),
  b.extend("%Response%", {
    literalPartsForm: { argument: 1, names: responseInitParts, path: "%CompilerHelpers%.newResponseFromParts" },
  }),
  b.static("%Response%.json", responseFromJSON),
  b.static("%Response%.redirect", redirection),
  b.static("%Response%.error", { returns: newResponse, capability: "heap", implementation: b.hostCall }),
  declareMethods("Response", membersOfMessage("Response")),

  b.construction("%Request%", requestConstruction),
  declareMethods("Request", membersOfMessage("Request")),

  b.construction("%Blob%", blobConstruction),
  declareMethods("Blob", membersOfBlob),
  b.static("%CompilerHelpers%.jsonSourceOfBody", jsonSourceOfBody),

  // What Bun.file makes of an "s3://" path, and an S3Client of a key.
  b.class("%S3File%", {
    extends: "Blob",
    instanceCppClass: b.cppClass("Bun::JSS3File", "JSS3File.h"),
    prototypeCppExpression:
      "globalObject->m_JSS3FileStructure.getInitializedOnMainThread(globalObject)->storedPrototypeObject()",
    instanceStructureCppExpression: "globalObject->m_JSS3FileStructure.getConcurrently()",
    hasConstructor: false,
    proto: {
      presign: b.otherwise,
      stat: b.otherwise,
      bucket: {
        this: b.any,
        getter: b.union(b.string, b.undefined),
        capability: "heap",
        throws: true,
        uses: { this: b.inspected },
        reads: externalState,
        implementation: b.generic,
      },
      "@@toStringTag": b.property(b.enumeration(["S3File"])),
    },
  }),
);
