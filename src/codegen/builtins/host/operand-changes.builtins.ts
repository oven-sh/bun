// What native functions do to what they are handed: those that change it, and those that change nothing. test/aot/builtins/native-contract.test.ts tells them apart.
import * as b from "bun-builtins-table";
import { bindingsChangingNothing, membersChangingNothing } from "./members-changing-nothing.ts";
import { keptHandlerCell, responseHandlerCell, socketDataCell } from "./native-cells.ts";
import { handedOver, mayAnswerWrapperKeptIn, objectHandedOver } from "./native-code.ts";

const ttyFunctions = "%BunTTYFunctions%";

// The bytes of a view or of the views in a list, or the elements of an array, before the call returns or once the operation has ended.
const filledWithBytes = [...handedOver, b.writesContents()];

const method = (path: b.BuiltinPath, uses: readonly b.UseSpec[]) =>
  b.method(path, {
    args: { operands: b.any.rest },
    returns: b.any,
    capability: "js",
    throws: true,
    uses: { this: objectHandedOver, operands: uses },
    implementation: b.hostCall,
  });

const fillsOperands = (path: b.BuiltinPath) => method(path, filledWithBytes);

// With an object in another position nothing is known of the call.
const positionsDescribed = 6;
const takingObjects = (taken: readonly number[], returns: b.TableType = b.any) => {
  const positions = Array.from({ length: positionsDescribed }, (_, position) => position);
  return {
    args: Object.fromEntries(
      positions.map(position => [`operand${position}`, (taken.includes(position) ? b.any : b.primitiveValue).optional]),
    ),
    returns,
    capability: "js",
    throws: true,
    uses: Object.fromEntries(taken.map(position => [`operand${position}`, handedOver])),
    implementation: b.hostCall,
  } satisfies b.FunctionField;
};
const methodTakingObjects = (path: b.BuiltinPath, taken: readonly number[]) => {
  const field = takingObjects(taken);
  return b.method(path, [{ ...field, uses: { this: objectHandedOver, ...field.uses } }, b.otherwiseBy(b.hostCall)]);
};
// What the code of the function answers.
const resultsOfBindingsChangingNothing: Readonly<Record<b.BuiltinPath, b.TableType>> = {
  "native:NewCppFunction:NodeTLS.cpp:loadExtraCACertificates": b.undefined,
  "native:NewCppFunction:NodeTLS.cpp:parseCACertificates": b.instance("Array").holding({ element: b.string }).fresh,
  "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsDeepStrictEqual": b.bool,
  "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionPartialDeepStrictEqual": b.bool,
  "native:NewCppFunction:decodeURIComponentSIMD.cpp:jsFunctionDecodeURIComponentSIMD": b.union(b.string, b.undefined),
  "native:NewCppFunction:stringWidth.cpp:jsFunctionBunStringWidth": b.f64,
};
// What the host answers for the binding itself, where that is no function: native-bindings.builtins.ts has the parts.
const answersOfBindingsChangingNothing: Readonly<Record<b.BuiltinPath, b.TableType>> = {
  "native:Cpp:NodeURL.cpp:Bun::createNodeURLBinding": b.layoutOf("NodeURLBinding").fresh,
};
const bindingTakingObjects = (path: b.BuiltinPath, taken: readonly number[]) => {
  const call = [takingObjects(taken, resultsOfBindingsChangingNothing[path]), b.otherwiseBy(b.hostCall)];
  const getter = answersOfBindingsChangingNothing[path];
  if (getter === undefined) return b.static(path, call);
  return b.static(path, { getter, capability: "heap", throws: true, implementation: b.generic, call });
};

const accessorColumns = { capability: "js", throws: true, implementation: b.hostCall } as const;

const getter = (path: b.BuiltinPath, hasSetter: boolean) =>
  b.method(path, {
    ...accessorColumns,
    getter: b.any,
    uses: { this: objectHandedOver },
    ...(hasSetter && {
      setter: { ...accessorColumns, value: b.any, uses: { this: objectHandedOver, value: handedOver } },
    }),
  });

// What a native binding answers is described by one entry: the function itself, or every function of the object.
const callOfBinding = (uses: readonly b.UseSpec[], returns: b.TableType = b.any) =>
  ({
    args: { operands: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { operands: uses },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;
const binding = (path: b.BuiltinPath, uses: readonly b.UseSpec[], returns?: b.TableType) =>
  b.static(path, callOfBinding(uses, returns));
// The host makes a new object each time it is asked, which is once for each module that names the binding.
const bindingAnswering = (path: b.BuiltinPath, answers: b.TableType, uses: readonly b.UseSpec[]) =>
  b.static(path, { getter: answers, capability: "heap", implementation: b.generic, call: callOfBinding(uses) });

// Called without `new` they throw and look at no operand.
const constructorsRequiringNew = [
  "%BlockList%",
  "%FrameworkFileSystemRouter%",
  "%H2FrameParser%",
  "%Immediate%",
  "%NativeBrotli%",
  "%NativeZlib%",
  "%NativeZstd%",
  "%NetworkSink%",
  "%S3Stat%",
  "%SecureContext%",
  "%ServerWebSocket%",
  "%SocketAddress%",
  "%Timeout%",
  "AbortSignal",
  "Blob",
  "BuildMessage",
  "CompressionStream",
  "Crypto",
  "CryptoKey",
  "DecompressionStream",
  "EventTarget",
  "HTMLRewriter",
  "Headers",
  "ReadableStream",
  "Request",
  "ResolveMessage",
  "Response",
  "SubtleCrypto",
  "TextDecoder",
  "URL",
  "URLPattern",
  "URLSearchParams",
  "node:module.SourceMap",
  "AbortController",
  "Bun.Archive",
  "Bun.Cookie",
  "Bun.CookieMap",
  "Bun.CryptoHasher",
  "Bun.FetchSession",
  "Bun.FileSystemRouter",
  "Bun.Glob",
  "Bun.Image",
  "Bun.MD4",
  "Bun.MD5",
  "Bun.RedisClient",
  "Bun.S3Client",
  "Bun.SHA1",
  "Bun.SHA224",
  "Bun.SHA256",
  "Bun.SHA384",
  "Bun.SHA512",
  "Bun.SHA512_256",
  "Bun.Transpiler",
];
const requiresNew = {
  returns: b.never,
  capability: "heap",
  throws: true,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// The setter keeps the value for the getter and does not look at it. Until then the getter answers a string that native code makes.
const keptValue = (path: b.BuiltinPath) =>
  b.method(path, {
    ...accessorColumns,
    getter: b.any,
    uses: { this: [...objectHandedOver, b.returnedFrom(path)] },
    setter: {
      ...accessorColumns,
      value: b.any,
      uses: { this: objectHandedOver, value: [b.retained, b.storedIn(b.nativeCell(path))] },
    },
  });

const readingMethods = ["read", "readSync", "readCb", "readv", "readvSync", "readvCb"];
const compressors = ["NativeZlib", "NativeBrotli", "NativeZstd"];
// init is handed the two words that every later write fills in.
const compressorMethods = ["init", "write", "writeSync"];

const streamSources = ["Blob", "Bytes", "File"];

const addressNames = b.keysNamed("family", "address", "port");

const keepsDataOfSocket = b.memberStoredIn(["data"], b.nativeCell(socketDataCell));

type HandlerCall = Pick<b.HandlerOptions, "this" | "args">;

// Native code keeps what is stored under the name and calls it for each event. The getter answers what is kept.
const keptHandler = (path: b.BuiltinPath, cell: string, call: HandlerCall) =>
  b.method(path, {
    getter: b.any,
    capability: "heap",
    uses: { this: [b.readsContents(), mayAnswerWrapperKeptIn(cell), b.returnedFrom(cell)] },
    implementation: b.hostCall,
    setter: {
      value: b.any,
      capability: "js",
      uses: {
        this: handedOver,
        value: [
          b.storedIn(b.nativeCell(cell)),
          b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "PerEvent", ...call, result: "Ignored" }),
        ],
      },
      implementation: b.hostCall,
    },
  });
const responseHandler = (name: string, call: HandlerCall) =>
  keptHandler(`%NodeHTTPResponse%.prototype.${name}`, responseHandlerCell(name), call);
const handlerOf = (path: b.BuiltinPath, call: HandlerCall) => keptHandler(path, keptHandlerCell(path), call);

export default b.declarations(
  readingMethods.flatMap(name => fillsOperands(`%NodeJSFS%.prototype.${name}`)),
  compressors.flatMap(className =>
    compressorMethods.flatMap(name => fillsOperands(`%${className}%.prototype.${name}`)),
  ),
  // It answers the view that it has filled.
  b.method("Crypto.prototype.getRandomValues", {
    args: { view: b.any.optional, others: b.any.rest },
    returns: b.operand("view"),
    capability: "js",
    throws: true,
    uses: { this: b.inspected, view: [b.writesContents()], others: b.inspected },
    implementation: b.hostCall,
  }),
  b.static("native:NewCppFunction:BunProcess.cpp:jsFunctionIsStandardOutputStream", {
    args: { value: b.any.optional },
    returns: b.bool,
    capability: "js",
    throws: true,
    uses: { value: b.inspected },
    implementation: b.hostCall,
  }),
  // pull fills the view, and stores into the array beside it that the source has ended.
  streamSources.flatMap(className => fillsOperands(`%${className}InternalReadableStreamSource%.prototype.pull`)),

  // node:crypto exports the two functions of the binding as they are.
  ["node:crypto.randomFill", "node:crypto.randomFillSync"].flatMap(path =>
    b.static(path, {
      args: { operands: b.any.rest },
      returns: b.any,
      capability: "js",
      throws: true,
      uses: { operands: filledWithBytes },
      implementation: b.generic,
    }),
  ),
  // getWindowSize stores the columns and the rows into the array it is handed.
  bindingAnswering(
    "native:Cpp:ProcessBindingTTYWrap.cpp:createBunTTYFunctions",
    b.builtin(ttyFunctions),
    filledWithBytes,
  ),
  // markAsUncloneable and markAsUntransferable put a mark on the object under a private name.
  binding("native:Cpp:Worker.cpp:createNodeWorkerThreadsBinding", [...handedOver, b.definesName(b.anyKey, b.bool)]),
  // An error that is reported gets its stack, and with it the position before the source map.
  binding(
    "native:NewCppFunction:BunProcess.cpp:jsFunctionReportUncaughtException",
    [...handedOver, b.definesName(["stack", "originalLine", "originalColumn"], b.any)],
    b.undefined,
  ),
  Object.entries(bindingsChangingNothing).flatMap(([path, { taken, refused }]) =>
    bindingTakingObjects(path, [...taken, ...refused]),
  ),
  constructorsRequiringNew.flatMap(path => b.callOfConstructor(path, requiresNew)),
  ["BuildMessage.prototype.message", "ResolveMessage.prototype.message", "ResolveMessage.prototype.stack"].flatMap(
    keptValue,
  ),
  b.construction("ReadableStream", {
    args: { source: b.any.optional, strategy: b.any.optional },
    returns: b.instance("ReadableStream").fresh,
    capability: "js",
    throws: true,
    uses: { source: handedOver, strategy: handedOver },
    implementation: b.hostCall,
  }),
  Object.entries(membersChangingNothing).flatMap(([holder, { methods, getters, accessors }]) => [
    ...Object.entries(methods).flatMap(([name, { taken, refused }]) =>
      methodTakingObjects(`${holder}.prototype.${name}`, [...taken, ...refused]),
    ),
    ...Object.keys(getters).flatMap(name => getter(`${holder}.prototype.${name}`, false)),
    ...Object.keys(accessors).flatMap(name => getter(`${holder}.prototype.${name}`, true)),
  ]),
  // The methods of %NodeJSFS%, of which the reading ones fill the views they are handed.
  bindingAnswering("native:Bindgen:node_fs_binding.bind.ts:binding", b.instance("NodeJSFS").fresh, filledWithBytes),

  // `data` of the options is `data` of the new socket.
  ...["TCPSocket", "TLSSocket"].map(className =>
    b.method(`%${className}%.prototype.upgradeTLS`, {
      args: { options: b.any.optional, others: b.any.rest },
      returns: b.any,
      capability: "js",
      throws: true,
      uses: { this: handedOver, options: [...handedOver, keepsDataOfSocket], others: handedOver },
      implementation: b.hostCall,
    }),
  ),
  responseHandler("ondata", {
    this: b.undefined,
    args: [b.union(b.instance("Buffer").fresh, b.undefined), b.bool, b.i32],
  }),
  responseHandler("onabort", { this: b.operand("this"), args: [b.i32] }),
  // node_zlib_binding.rs emit_error: the message, the number of the error and its code. Only a function is kept.
  compressors.flatMap(className =>
    handlerOf(`%${className}%.prototype.onerror`, { this: b.operand("this"), args: [b.string, b.f64, b.string] }),
  ),
  // PostgresSQLConnection.rs on_notification: the channel and the payload.
  handlerOf("%PostgresSQLConnection%.prototype.onnotification", { this: b.undefined, args: [b.string, b.string] }),
  // js_valkey.rs: a job calls onconnect with the client and what the server has answered to HELLO. onclose gets the error that native code has made.
  handlerOf("Bun.RedisClient.prototype.onconnect", { this: b.undefined, args: [b.operand("this"), b.any] }),
  handlerOf("Bun.RedisClient.prototype.onclose", { this: b.operand("this"), args: [b.any] }),
  // It also answers the callback of a write that has not gone out whole, which was handed over like any operand.
  responseHandler("onwritable", { this: b.undefined, args: [b.f64] }),
  // What the callback writes goes out in one piece when it returns.
  b.method("%NodeHTTPResponse%.prototype.cork", {
    args: { callback: b.callable },
    returns: b.callbackResult("callback"),
    capability: "js",
    throws: true,
    uses: {
      this: handedOver,
      callback: [
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "Once",
          this: b.undefined,
          args: [],
          result: "Returned",
        }),
      ],
    },
    implementation: b.hostCall,
  }),

  // Each own member of the object is read and turned into a string.
  b.method("%ParsedShellScript%.prototype.setEnv", {
    args: { env: b.any.optional, others: b.any.rest },
    returns: b.undefined,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: b.inspected, env: [b.runsTransitively("OwnKeys", "OwnValues", "ToPrimitive")], others: b.inspected },
    implementation: b.hostCall,
  }),

  b.method("%Listener%.prototype.getsockname", {
    args: { out: b.any.optional },
    returns: b.undefined,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: b.inspected, out: [b.storedByKey(addressNames, b.union(b.string, b.f64, b.undefined))] },
    implementation: b.hostCall,
  }),
);
