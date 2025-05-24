/// <reference types="../../build/debug/codegen/generated.d.ts" />
/// <reference types="../../build/debug/codegen/ErrorCode.d.ts" />
/// <reference types="../../build/debug/codegen/ZigGeneratedClasses.d.ts" />
/// <reference types="../../build/debug/codegen/WebCoreJSBuiltins.d.ts" />

// Typedefs for JSC intrinsics. Instead of @, we use $
type TODO = any;

/** $debug is a preprocessor macro that works like a templated console.log, and only runs in debug mode if you pass
 * BUN_DEBUG_JS=<module>
 *
 * So to get node stream to log, you pass BUN_DEBUG_JS=stream or BUN_DEBUG_JS=node:stream
 *
 * This only works in debug builds, the log fn is completely removed in release builds.
 */
declare function $debug(...args: any[]): void;
/**
 * Assert that a condition holds in debug builds.
 *
 * $assert is a preprocessor macro that only runs in debug mode. it throws an
 * error if the first argument is falsy.  The source code passed to `check` is
 * inlined in the message, but in addition you can pass additional messages.
 *
 * @note gets removed in release builds. Do not put code with side effects in the `check`.
 */
declare function $assert(check: any, ...message: any[]): asserts check;

/** Asserts the input is a promise. Returns `true` if the promise is resolved */
declare function $isPromiseFulfilled(promise: Promise<any>): boolean;
/** Asserts the input is a promise. Returns `true` if the promise is rejected */
declare function $isPromiseRejected(promise: Promise<any>): boolean;
/** Asserts the input is a promise. Returns `true` if the promise is pending */
declare function $isPromisePending(promise: Promise<any>): boolean;

declare const IS_BUN_DEVELOPMENT: boolean;

/** Place this directly above a function declaration (like a decorator) to make it a getter. */
declare const $getter: never;
/** Assign to this directly above a function declaration (like a decorator) to override the function's display name. */
declare var $overriddenName: string;
/** ??? */
declare var $linkTimeConstant: never;
/** Assign to this directly above a function declaration (like a decorator) to set visibility */
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
/** ??? */
declare var $nakedConstructor: never;
/** Assign to this directly above a function declaration (like a decorator) to set intrinsic */
declare var $intrinsic: string;
/** Assign to this directly above a function declaration (like a decorator) to make it a constructor. */
declare var $constructor;
/** Place this directly above a function declaration (like a decorator) to NOT include "use strict" */
declare var $sloppy;
/** Place this directly above a function declaration (like a decorator) to always inline the function */
declare var $alwaysInline;

declare function $extractHighWaterMarkFromQueuingStrategyInit(obj: any): any;
/**
 * Overrides **
 */

interface ReadableStreamDefaultController<R = any> extends _ReadableStreamDefaultController<R> {
  $controlledReadableStream: ReadableStream<R>;
  $underlyingSource: UnderlyingSource;
  $queue: any;
  $started: number;
  $closeRequested: boolean;
  $pullAgain: boolean;
  $pulling: boolean;
  $strategy: any;

  $pullAlgorithm(): void;
  $pull: typeof ReadableStreamDefaultController.prototype.pull;
  $cancel: typeof ReadableStreamDefaultController.prototype.cancel;
  $cancelAlgorithm: (reason?: any) => void;
  $close: typeof ReadableStreamDefaultController.prototype.close;
  $enqueue: typeof ReadableStreamDefaultController.prototype.enqueue;
  $error: typeof ReadableStreamDefaultController.prototype.error;
}

declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
  new (): ReadableStreamDefaultController;
};

interface ReadableStream<R = any> extends _ReadableStream<R> {
  $highWaterMark: number;
  $bunNativePtr: undefined | TODO;
  $asyncContext?: {};
  $disturbed: boolean;
  $state: $streamClosed | $streamErrored | $streamReadable | $streamWritable | $streamClosedAndErrored;
}

declare var ReadableStream: {
  prototype: ReadableStream;
  new (): ReadableStream;
};

interface Console {
  $writer: ReturnType<typeof Bun.stdout.writer>;
}

// JSC defines their intrinsics in a nice list here:
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecode/BytecodeIntrinsicRegistry.h
//
// And implemented here: (search for "emit_intrinsic_<name>", like "emit_intrinsic_arrayPush")
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecompiler/NodesCodegen.cpp

/** returns `arguments[index]` */
declare function $argument<T = any>(index: number): any | undefined;
/** returns number of arguments */
declare function $argumentCount(): number;
/** array.push(item) */
declare function $arrayPush(array: T[], item: T): void;

/**
 * gets a property on an object
 */
declare function $getByValWithThis(target: any, receiver: any, propertyKey: string): void;
/** gets the prototype of an object */
declare function $getPrototypeOf(value: any): any;
/**
 * Gets an internal property on a promise
 *
 *  You can pass
 *  - {@link $promiseFieldFlags} - get a number with flags
 *  - {@link $promiseFieldReactionsOrResult} - get the result (like {@link Bun.peek})
 *
 * @param promise the promise to get the field from
 * @param key an internal field id.
 */
declare function $getPromiseInternalField<K extends PromiseFieldType, V>(
  promise: Promise<V>,
  key: K,
): PromiseFieldToValue<K, V>;
declare function $getInternalField<Fields extends any[], N extends keyof Fields>(
  base: InternalFieldObject<Fields>,
  number: N,
): Fields[N];
declare function $fulfillPromise(...args: any[]): TODO;
declare function $loadEsmIntoCjs(...args: any[]): TODO;
declare function $getGeneratorInternalField(): TODO;
declare function $getAsyncGeneratorInternalField(): TODO;
declare function $getAbstractModuleRecordInternalField(): TODO;
declare function $getArrayIteratorInternalField(): TODO;
declare function $getStringIteratorInternalField(): TODO;
declare function $getMapIteratorInternalField(): TODO;
declare function $getSetIteratorInternalField(): TODO;
declare function $getProxyInternalField(): TODO;
declare function $idWithProfile(): TODO;
/**
 * True for object-like `JSCell`s. That is, this is roughly equivalent to this
 * JS code:
 * ```js
 * typeof obj === "object" && obj !== null
 * ```
 *
 * @param obj The object to check
 * @returns `true` if `obj` is an object-like `JSCell`
 *
 * @see [JSCell.h](https://github.com/oven-sh/WebKit/blob/main/Source/JavaScriptCore/runtime/JSCell.h)
 * @see [JIT implementation](https://github.com/oven-sh/WebKit/blob/433f7598bf3537a295d0af5ffd83b9a307abec4e/Source/JavaScriptCore/jit/JITOpcodes.cpp#L311)
 */
declare function $isObject(obj: unknown): obj is object;
declare function $isArray(obj: unknown): obj is any[];
declare function $isCallable(fn: unknown): fn is CallableFunction;
declare function $isConstructor(fn: unknown): fn is { new (...args: any[]): any };
declare function $isJSArray(obj: unknown): obj is any[];
declare function $isProxyObject(obj: unknown): obj is Proxy;
declare function $isDerivedArray(): TODO;
declare function $isGenerator(obj: unknown): obj is Generator<any, any, any>;
declare function $isAsyncGenerator(obj: unknown): obj is AsyncGenerator<any, any, any>;
declare function $isRegExpObject(obj: unknown): obj is RegExp;
declare function $isMap<K, V>(obj: unknown): obj is Map<K, V>;
declare function $isSet<V>(obj: unknown): obj is Set<V>;
declare function $isShadowRealm(obj: unknown): obj is ShadowRealm;
declare function $isStringIterator(obj: unknown): obj is Iterator<string>;
declare function $isArrayIterator(obj: unknown): obj is Iterator<any>;
declare function $isMapIterator(obj: unknown): obj is Iterator<any>;
declare function $isSetIterator(obj: unknown): obj is Iterator<any>;
declare function $isUndefinedOrNull(obj: unknown): obj is null | undefined;
declare function $tailCallForwardArguments(fn: CallableFunction, thisValue: ThisType): any;
/**
 * **NOTE** - use `throw new TypeError()` instead. it compiles to the same builtin
 * @deprecated
 */
declare function $throwTypeError(message: string): never;
/**
 * **NOTE** - use `throw new RangeError()` instead. it compiles to the same builtin
 * @deprecated
 */
declare function $throwRangeError(message: string): never;
/**
 * **NOTE** - use `throw new OutOfMemoryError()` instead. it compiles to the same builtin
 * @deprecated
 */
declare function $throwOutOfMemoryError(): never;
declare function $tryGetById(): TODO;
declare function $tryGetByIdWithWellKnownSymbol(obj: any, key: WellKnownSymbol): any;
declare function $putByIdDirect(obj: any, key: PropertyKey, value: any): void;

/**
 * Sets a private property on an object.
 * Translates to the `op_put_by_id_direct` bytecode.
 *
 * @param obj The object to set the private property on
 * @param key The key of the private property (without the "$" prefix)
 * @param value The value to set the private property to
 */
declare function $putByIdDirectPrivate<T extends Record<`$${K}`, unknown>, K extends string>(
  obj: T,
  key: K,
  value: T[`$${K}`],
): void;

declare function $putByValDirect(obj: any, key: PropertyKey, value: any): void;
declare function $putByValWithThisSloppy(): TODO;
declare function $putByValWithThisStrict(): TODO;
declare function $putInternalField<Fields extends any[], N extends keyof Fields>(
  base: InternalFieldObject<Fields>,
  number: N,
  value: Fields[N],
): void;
declare function $putPromiseInternalField<T extends PromiseFieldType, P extends Promise<any>>(
  promise: P,
  key: T,
  value: PromiseFieldToValue<T, P>,
): void;
declare function $putGeneratorInternalField(): TODO;
declare function $putAsyncGeneratorInternalField(): TODO;
declare function $putArrayIteratorInternalField(): TODO;
declare function $putStringIteratorInternalField(): TODO;
declare function $putMapIteratorInternalField(): TODO;
declare function $putSetIteratorInternalField(): TODO;
declare function $superSamplerBegin(): TODO;
declare function $superSamplerEnd(): TODO;
declare function $toNumber(x: any): number;
declare function $toString(x: any): string;
declare function $toPropertyKey(x: any): PropertyKey;
/**
 * Often used like
 * `$toObject(this, "Class.prototype.method requires that |this| not be null or undefined");`
 */
declare function $toObject(object: any, errorMessage?: string): object;
/**
 * ## References
 * - [WebKit - `emit_intrinsic_newArrayWithSize`](https://github.com/oven-sh/WebKit/blob/e1a802a2287edfe7f4046a9dd8307c8b59f5d816/Source/JavaScriptCore/bytecompiler/NodesCodegen.cpp#L2317)
 */
declare function $newArrayWithSize<T>(size: number): T[];
/**
 * Optimized path for creating a new array storing objects with the same homogenous Structure
 * as {@link array}.
 *
 * @param size the initial size of the new array
 * @param array the array whose shape we want to copy
 *
 * @returns a new array
 *
 * ## References
 * - [WebKit - `emit_intrinsic_newArrayWithSpecies`](https://github.com/oven-sh/WebKit/blob/e1a802a2287edfe7f4046a9dd8307c8b59f5d816/Source/JavaScriptCore/bytecompiler/NodesCodegen.cpp#L2328)
 * - [WebKit - #4909](https://github.com/WebKit/WebKit/pull/4909)
 * - [WebKit Bugzilla - Related Issue/Ticket](https://bugs.webkit.org/show_bug.cgi?id=245797)
 */
declare function $newArrayWithSpecies<T>(size: number, array: T[]): T[];
declare function $newPromise(): TODO;
declare function $createPromise(): TODO;
declare const $iterationKindKey: TODO;
declare const $iterationKindValue: TODO;
declare const $iterationKindEntries: TODO;
declare const $MAX_ARRAY_INDEX: number;
declare const $MAX_STRING_LENGTH: number;
declare const $MAX_SAFE_INTEGER: number;
declare const $ModuleFetch: number;
declare const $ModuleTranslate: number;
declare const $ModuleInstantiate: number;
declare const $ModuleSatisfy: number;
declare const $ModuleLink: number;
declare const $ModuleReady: number;
declare const $promiseRejectionReject: TODO;
declare const $promiseRejectionHandle: TODO;
declare const $promiseStatePending: number;
declare const $promiseStateFulfilled: number;
declare const $promiseStateRejected: number;
declare const $promiseStateMask: number;
declare const $promiseFlagsIsHandled: number;
declare const $promiseFlagsIsFirstResolvingFunctionCalled: number;
declare const $promiseFieldFlags: 0;
declare const $promiseFieldReactionsOrResult: 1;
declare const $proxyFieldTarget: TODO;
declare const $proxyFieldHandler: TODO;
declare const $generatorFieldState: TODO;
declare const $generatorFieldNext: TODO;
declare const $generatorFieldThis: TODO;
declare const $generatorFieldFrame: TODO;
declare const $generatorFieldContext: TODO;
declare const $GeneratorResumeModeNormal: TODO;
declare const $GeneratorResumeModeThrow: TODO;
declare const $GeneratorResumeModeReturn: TODO;
declare const $GeneratorStateCompleted: TODO;
declare const $GeneratorStateExecuting: TODO;
declare const $arrayIteratorFieldIndex: TODO;
declare const $arrayIteratorFieldIteratedObject: TODO;
declare const $arrayIteratorFieldKind: TODO;
declare const $mapIteratorFieldMapBucket: TODO;
declare const $mapIteratorFieldKind: TODO;
declare const $setIteratorFieldSetBucket: TODO;
declare const $setIteratorFieldKind: TODO;
declare const $stringIteratorFieldIndex: TODO;
declare const $stringIteratorFieldIteratedString: TODO;
declare const $asyncGeneratorFieldSuspendReason: TODO;
declare const $asyncGeneratorFieldQueueFirst: TODO;
declare const $asyncGeneratorFieldQueueLast: TODO;
declare const $AsyncGeneratorStateCompleted: TODO;
declare const $AsyncGeneratorStateExecuting: TODO;
declare const $AsyncGeneratorStateAwaitingReturn: TODO;
declare const $AsyncGeneratorStateSuspendedStart: TODO;
declare const $AsyncGeneratorStateSuspendedYield: TODO;
declare const $AsyncGeneratorSuspendReasonYield: TODO;
declare const $AsyncGeneratorSuspendReasonAwait: TODO;
declare const $AsyncGeneratorSuspendReasonNone: TODO;
declare const $abstractModuleRecordFieldState: TODO;
declare const $processBindingConstants: {
  os: typeof import("os").constants;
  fs: typeof import("fs").constants;
  crypto: typeof import("crypto").constants;
  zlib: typeof import("zlib").constants;
};
declare const $asyncContext: InternalFieldObject<[ReadonlyArray<any> | undefined]>;

// We define our intrinsics in ./BunBuiltinNames.h. Some of those are globals.

declare var $_events: TODO;
declare function $abortAlgorithm(): TODO;
declare function $abortSteps(): TODO;
declare function $addAbortAlgorithmToSignal(signal: AbortSignal, algorithm: () => void): TODO;
declare function $addEventListener(): TODO;
declare function $appendFromJS(): TODO;
declare function $argv(): TODO;
declare function $assignToStream(): TODO;
declare function $associatedReadableByteStreamController(): TODO;
declare function $autoAllocateChunkSize(): TODO;
declare function $backpressure(): TODO;
declare function $backpressureChangePromise(): TODO;
declare function $basename(): TODO;
declare function $body(): TODO;
declare function $bunNativePtr(): TODO;
declare function $bunNativeType(): TODO;
declare function $byobRequest(): TODO;
declare function $cancel(): TODO;
declare function $cancelAlgorithm(): TODO;
declare function $chdir(): TODO;
declare function $cloneArrayBuffer(a, b, c): TODO;
declare function $close(): TODO;
declare function $closeAlgorithm(): TODO;
declare function $closeRequest(): TODO;
declare function $closeRequested(): TODO;
declare function $closed(): TODO;
declare function $closedPromise(): TODO;
declare function $closedPromiseCapability(): TODO;
declare function $code(): TODO;
declare function $connect(): TODO;
declare function $controlledReadableStream(): TODO;
declare function $controller(): TODO;
declare function $cork(): TODO;
declare function $createEmptyReadableStream(): TODO;
declare function $createFIFO(): TODO;
declare function $createNativeReadableStream(): TODO;
declare function $createReadableStream(): TODO;
declare function $createUninitializedArrayBuffer(size: number): ArrayBuffer;
declare function $createWritableStreamFromInternal(...args: any[]): TODO;
declare function $cwd(): TODO;
declare function $data(): TODO;
declare function $dataView(): TODO;
declare function $decode(): TODO;
declare function $delimiter(): TODO;
declare function $destroy(): TODO;
declare function $dir(): TODO;
declare function $direct(): TODO;
declare function $dirname(): TODO;
declare function $disturbed(): TODO;
declare function $document(): TODO;
declare function $encode(): TODO;
declare function $encoding(): TODO;
declare function $end(): TODO;
declare function $errno(): TODO;
declare function $errorSteps(): TODO;
declare function $execArgv(): TODO;
declare function $extname(): TODO;
declare function $failureKind(): TODO;
declare function $fatal(): TODO;
declare function $fetch(): TODO;
declare function $fetchRequest(): TODO;
declare function $file(): TODO;
declare function $filePath(): TODO;
declare function $fillFromJS(): TODO;
declare function $filter(): TODO;
declare function $finishConsumingStream(): TODO;
declare function $flush(): TODO;
declare function $flushAlgorithm(): TODO;
declare function $format(): TODO;
declare function $fulfillModuleSync(key: string): void;
declare function $get(): TODO;
declare function $getInternalWritableStream(writable: WritableStream): TODO;
declare function $handleEvent(): TODO;
declare function $hash(): TODO;
declare function $header(): TODO;
declare function $headers(): TODO;
declare function $highWaterMark(): TODO;
declare function $host(): TODO;
declare function $hostname(): TODO;
declare function $href(): TODO;
declare function $ignoreBOM(): TODO;
declare function $importer(): TODO;
declare function $inFlightCloseRequest(): TODO;
declare function $inFlightWriteRequest(): TODO;
declare function $initializeWith(): TODO;
declare function $internalRequire(id: string, parent: JSCommonJSModule): TODO;
declare function $internalStream(): TODO;
declare function $internalWritable(): TODO;
declare function $isAbortSignal(signal: unknown): signal is AbortSignal;
declare function $isAbsolute(): TODO;
declare function $isDisturbed(): TODO;
declare function $isPaused(): TODO;
declare function $join(): TODO;
declare function $kind(): TODO;
declare const $lazyStreamPrototypeMap: Map<string, typeof import("node:stream/web").ReadableStreamDefaultController>;
declare function $loadModule(): TODO;
declare function $localStreams(): TODO;
declare function $main(): TODO;
declare function $makeDOMException(): TODO;
declare function $makeGetterTypeError(className: string, prop: string): Error;
declare function $map(): TODO;
declare function $method(): TODO;
declare function $nextTick(): TODO;
declare function $normalize(): TODO;
declare function $on(): TODO;
declare function $once(): TODO;
declare function $options(): TODO;
declare function $origin(): TODO;
declare function $ownerReadableStream(): TODO;
declare function $parse(): TODO;
declare function $password(): TODO;
declare function $patch(): TODO;
declare function $path(): TODO;
declare function $pathname(): TODO;
declare function $pause(): TODO;
declare function $pendingAbortRequest(): TODO;
declare function $pendingPullIntos(): TODO;
declare function $pid(): TODO;
declare function $pipe(): TODO;
declare function $port(): TODO;
declare function $post(): TODO;
declare function $ppid(): TODO;
declare function $prependEventListener(): TODO;
declare function $process(): TODO;
declare function $protocol(): TODO;
declare function $pull(): TODO;
declare function $pullAgain(): TODO;
declare function $pullAlgorithm(): TODO;
declare function $pulling(): TODO;
declare function $put(): TODO;
declare function $queue(): TODO;
declare function $read(): TODO;
declare function $readIntoRequests(): TODO;
declare function $readRequests(): TODO;
declare function $readable(): TODO;
declare function $readableByteStreamControllerGetDesiredSize(...args: any): TODO;
declare function $readableStreamController(): TODO;
declare function $readableStreamToArray(): TODO;
declare function $reader(): TODO;
declare function $readyPromise(): TODO;
declare function $readyPromiseCapability(): TODO;
declare function $removeAbortAlgorithmFromSignal(signal: AbortSignal, algorithmIdentifier: number): TODO;
declare function $redirect(): TODO;
declare function $relative(): TODO;
declare function $releaseLock(): TODO;
declare function $removeEventListener(): TODO;
declare function $require(): TODO;
declare function $requireESM(path: string): any;
declare const $requireMap: Map<string, JSCommonJSModule>;
declare const $internalModuleRegistry: InternalFieldObject<any[]>;
declare function $resolve(name: string, from: string): Promise<string>;
declare function $resolveSync(
  name: string,
  from: string,
  isESM?: boolean,
  isUserRequireResolve?: boolean,
  paths?: string[],
): string;
declare function $resume(): TODO;
declare function $search(): TODO;
declare function $searchParams(): TODO;
declare function $self(): TODO;
declare function $sep(): TODO;
declare function $setBody(): TODO;
declare function $setStatus(): TODO;
declare function $setup(): TODO;
declare function $sink(): TODO;
declare function $size(): TODO;
declare function $start(): TODO;
declare function $startAlgorithm(): TODO;
declare function $startConsumingStream(): TODO;
declare function $startDirectStream(): TODO;
declare function $started(): TODO;
declare function $startedPromise(): TODO;
declare function $state(): TODO;
declare function $status(): TODO;
declare function $storedError(): TODO;
declare function $strategy(): TODO;
declare function $strategyHWM(): TODO;
declare function $strategySizeAlgorithm(): TODO;
declare function $stream(): TODO;
declare function $streamClosed(): TODO;
declare function $streamClosing(): TODO;
declare function $streamErrored(): TODO;
declare function $streamReadable(): TODO;
declare function $streamWaiting(): TODO;
declare function $streamWritable(): TODO;
declare function $structuredCloneForStream(): TODO;
declare function $syscall(): TODO;
declare function $textDecoderStreamDecoder(): TODO;
declare function $textDecoderStreamTransform(): TODO;
declare function $textEncoderStreamEncoder(): TODO;
declare function $textEncoderStreamTransform(): TODO;
declare function $toNamespacedPath(): TODO;
declare function $trace(): TODO;
declare function $transformAlgorithm(): TODO;
declare function $uncork(): TODO;
declare function $underlyingByteSource(): TODO;
declare function $underlyingSink(): TODO;
declare function $underlyingSource(): TODO;
declare function $unpipe(): TODO;
declare function $unshift(): TODO;
declare function $url(): TODO;
declare function $username(): TODO;
declare function $version(): TODO;
declare function $versions(): TODO;
declare function $view(): TODO;
declare function $whenSignalAborted(signal: AbortSignal, cb: (reason: any) => void): TODO;
declare function $writable(): TODO;
declare function $write(): TODO;
declare function $writeAlgorithm(): TODO;
declare function $writeRequests(): TODO;
declare function $writer(): TODO;
declare function $writing(): TODO;
declare function $written(): TODO;

declare function $createCommonJSModule(
  id: string,
  exports: any,
  hasEvaluated: boolean,
  parent: JSCommonJSModule | undefined,
): JSCommonJSModule;
declare function $evaluateCommonJSModule(
  moduleToEvaluate: JSCommonJSModule,
  sourceModule: JSCommonJSModule,
): JSCommonJSModule[];

declare function $overridableRequire(this: JSCommonJSModule, id: string): any;

// The following I cannot find any definitions of, but they are functional.
declare function $toLength(length: number): number;
declare function $isTypedArrayView(obj: unknown): obj is ArrayBufferView | DataView | Uint8Array;
declare function $setStateToMax(target: any, state: number): void;
declare function $trunc(target: number): number;
declare function $newPromiseCapability(C: PromiseConstructor): TODO;
/** @deprecated, use new TypeError instead */
declare function $makeTypeError(message: string): TypeError;
declare function $newHandledRejectedPromise(error: unknown): Promise<never>;

declare const __internal: unique symbol;
interface InternalFieldObject<T extends any[]> {
  [__internal]: T;
}

// Types used in the above functions
type PromiseFieldType = typeof $promiseFieldFlags | typeof $promiseFieldReactionsOrResult;
type PromiseFieldToValue<X extends PromiseFieldType, V> = X extends typeof $promiseFieldFlags
  ? number
  : X extends typeof $promiseFieldReactionsOrResult
    ? V | any
    : any;
type WellKnownSymbol = keyof { [K in keyof SymbolConstructor as SymbolConstructor[K] extends symbol ? K : never]: K };

// You can also `@` on any method on a classes to avoid prototype pollution and secret internals
type ClassWithIntrinsics<T> = { [K in keyof T as T[K] extends Function ? `$${K}` : never]: T[K] };

declare interface Map<K, V> extends ClassWithIntrinsics<Map<K, V>> {}
declare interface CallableFunction extends ClassWithIntrinsics<CallableFunction> {}
declare interface Promise<T> extends ClassWithIntrinsics<Promise<T>> {}
declare interface ArrayBufferConstructor<T> extends ClassWithIntrinsics<ArrayBufferConstructor<T>> {}
declare interface PromiseConstructor<T> extends ClassWithIntrinsics<PromiseConstructor<T>> {}

declare interface UnderlyingSource {
  $lazy?: boolean;
  $bunNativePtr?: undefined | TODO;
  autoAllocateChunkSize?: number;
  $stream?: ReadableStream;
}

declare class OutOfMemoryError {
  constructor();
}

declare class ReadableStreamDefaultController {
  constructor(
    stream: unknown,
    underlyingSource: unknown,
    size: unknown,
    highWaterMark: unknown,
    $isReadableStream: typeof $isReadableStream,
  );
}
declare class ReadableByteStreamController {
  constructor(
    stream: unknown,
    underlyingSource: unknown,
    strategy: unknown,
    $isReadableStream: typeof $isReadableStream,
  );
}
declare class ReadableStreamBYOBRequest {
  constructor(stream: unknown, view: unknown, $isReadableStream: typeof $isReadableStream);
}
declare class ReadableStreamBYOBReader {
  constructor(stream: unknown);
}

// Inlining our enum types
declare const $ImportKindIdToLabel: Array<import("bun").ImportKind>;
declare const $ImportKindLabelToId: Record<import("bun").ImportKind, number>;
declare const $LoaderIdToLabel: Array<import("bun").Loader>;
declare const $LoaderLabelToId: Record<import("bun").Loader, number>;

// not a builtin, but a build-time macro of our own
/** Returns a not implemented error that points to a github issue. */
declare function notImplementedIssue(issueNumber: number, description: string): Error;
/** Return a function that throws a not implemented error that points to a github issue */
declare function notImplementedIssueFn(issueNumber: number, description: string): (...args: any[]) => never;

declare type JSCSourceCodeObject = unique symbol;

declare interface Function {
  path: string;
}

interface String {
  $charCodeAt: String["charCodeAt"];
  // add others as needed
}

interface Set {
  $add: Set["add"];
  $clear: Set["clear"];
  $delete: Set["delete"];
  $has: Set["has"];
}

interface Map {
  $clear: Map["clear"];
  $delete: Map["delete"];
  $has: Map["has"];
  $set: Map["set"];
  $get: Map["get"];
}

declare var $Buffer: {
  new (array: Array): Buffer;
  new (arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
  new (buffer: Buffer): Buffer;
  new (size: number): Buffer;
  new (string: string, encoding?: BufferEncoding): Buffer;
};

declare interface Error {
  code?: string;
}

declare function $makeAbortError(message?: string, options?: { cause: Error }): Error;

/**
 * -- Error Codes with manual messages
 */
declare function $ERR_INVALID_ARG_TYPE(argName: string, expectedType: string, actualValue: any): TypeError;
declare function $ERR_INVALID_ARG_TYPE(argName: string, expectedTypes: string[], actualValue: any): TypeError;
declare function $ERR_INVALID_ARG_VALUE(name: string, value: any, reason?: string): TypeError;
declare function $ERR_UNKNOWN_ENCODING(enc: string): TypeError;
declare function $ERR_STREAM_DESTROYED(method: string): Error;
declare function $ERR_METHOD_NOT_IMPLEMENTED(method: string): Error;
declare function $ERR_STREAM_ALREADY_FINISHED(method: string): Error;
declare function $ERR_MISSING_ARGS(...args: [string, ...string[]]): TypeError;
/**
 * `The "foo" or "bar" or "baz" argument must be specified`
 *
 * Panics if `oneOf` is empty.
 */
declare function $ERR_MISSING_ARGS(oneOf: string[]): TypeError;
declare function $ERR_INVALID_RETURN_VALUE(expected_type: string, name: string, actual_value: any): TypeError;
declare function $ERR_TLS_INVALID_PROTOCOL_VERSION(a: string, b: string): TypeError;
declare function $ERR_TLS_PROTOCOL_VERSION_CONFLICT(a: string, b: string): TypeError;
declare function $ERR_INVALID_IP_ADDRESS(ip: any): TypeError;
declare function $ERR_INVALID_ADDRESS_FAMILY(addressType, host, port): RangeError;
declare function $ERR_OUT_OF_RANGE(name: string, reason: string, value): RangeError;
declare function $ERR_BUFFER_TOO_LARGE(len: number): RangeError;
declare function $ERR_BROTLI_INVALID_PARAM(p: number): RangeError;
declare function $ERR_TLS_CERT_ALTNAME_INVALID(reason: string, host: string, cert): Error;
declare function $ERR_USE_AFTER_CLOSE(name: string): Error;
declare function $ERR_HTTP2_INVALID_HEADER_VALUE(value: string, name: string): TypeError;
declare function $ERR_INVALID_HANDLE_TYPE(): TypeError;
declare function $ERR_INVALID_HTTP_TOKEN(name: string, value: string): TypeError;
declare function $ERR_HTTP2_STATUS_INVALID(code: number): RangeError;
declare function $ERR_HTTP2_INVALID_PSEUDOHEADER(name: string): TypeError;
declare function $ERR_HTTP2_STREAM_ERROR(code): Error;
declare function $ERR_HTTP2_SESSION_ERROR(code): Error;
declare function $ERR_HTTP2_PAYLOAD_FORBIDDEN(status): Error;
declare function $ERR_HTTP2_INVALID_INFO_STATUS(code): RangeError;
declare function $ERR_INVALID_URL(input, base?): TypeError;
declare function $ERR_INVALID_CHAR(name, field?): TypeError;
declare function $ERR_HTTP_INVALID_HEADER_VALUE(value: string, name: string): TypeError;
declare function $ERR_HTTP_HEADERS_SENT(action: string): Error;
declare function $ERR_INVALID_PROTOCOL(proto, expected): TypeError;
declare function $ERR_INVALID_STATE(message: string): Error;
declare function $ERR_INVALID_STATE_TypeError(message: string): TypeError;
declare function $ERR_INVALID_STATE_RangeError(message: string): RangeError;
declare function $ERR_UNESCAPED_CHARACTERS(arg): TypeError;
declare function $ERR_HTTP_INVALID_STATUS_CODE(code): RangeError;
declare function $ERR_UNHANDLED_ERROR(err?): Error;
declare function $ERR_BUFFER_OUT_OF_BOUNDS(name?: string): RangeError;
declare function $ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(value, expected): TypeError;
declare function $ERR_CRYPTO_INCOMPATIBLE_KEY(name, value): Error;
declare function $ERR_CHILD_PROCESS_IPC_REQUIRED(where): Error;
declare function $ERR_CHILD_PROCESS_STDIO_MAXBUFFER(message): Error;
declare function $ERR_INVALID_ASYNC_ID(name, value): RangeError;
declare function $ERR_ASYNC_TYPE(name): TypeError;
declare function $ERR_ASYNC_CALLBACK(name): TypeError;
declare function $ERR_AMBIGUOUS_ARGUMENT(arg, message): TypeError;

declare function $ERR_IPC_DISCONNECTED(): Error;
declare function $ERR_SERVER_NOT_RUNNING(): Error;
declare function $ERR_IPC_CHANNEL_CLOSED(): Error;
declare function $ERR_SOCKET_BAD_TYPE(): Error;
declare function $ERR_ZLIB_INITIALIZATION_FAILED(): Error;
declare function $ERR_IPC_ONE_PIPE(): Error;
declare function $ERR_SOCKET_ALREADY_BOUND(): Error;
declare function $ERR_SOCKET_BAD_BUFFER_SIZE(): Error;
declare function $ERR_SOCKET_DGRAM_IS_CONNECTED(): Error;
declare function $ERR_SOCKET_DGRAM_NOT_CONNECTED(): Error;
declare function $ERR_SOCKET_DGRAM_NOT_RUNNING(): Error;
declare function $ERR_INVALID_CURSOR_POS(): Error;
declare function $ERR_MULTIPLE_CALLBACK(): Error;
declare function $ERR_STREAM_PREMATURE_CLOSE(): Error;
declare function $ERR_STREAM_NULL_VALUES(): TypeError;
declare function $ERR_STREAM_CANNOT_PIPE(): Error;
declare function $ERR_STREAM_WRITE_AFTER_END(): Error;
declare function $ERR_STREAM_UNSHIFT_AFTER_END_EVENT(): Error;
declare function $ERR_STREAM_PUSH_AFTER_EOF(): Error;
declare function $ERR_STREAM_UNABLE_TO_PIPE(): Error;
declare function $ERR_ILLEGAL_CONSTRUCTOR(): TypeError;
declare function $ERR_SERVER_ALREADY_LISTEN(): Error;
declare function $ERR_SOCKET_CLOSED(): Error;
declare function $ERR_SOCKET_CLOSED_BEFORE_CONNECTION(): Error;
declare function $ERR_TLS_RENEGOTIATION_DISABLED(): Error;
declare function $ERR_UNAVAILABLE_DURING_EXIT(): Error;
declare function $ERR_TLS_CERT_ALTNAME_FORMAT(): SyntaxError;
declare function $ERR_TLS_SNI_FROM_SERVER(): Error;
declare function $ERR_INVALID_URI(): URIError;
declare function $ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED(): TypeError;
declare function $ERR_HTTP2_INFO_STATUS_NOT_ALLOWED(): RangeError;
declare function $ERR_HTTP2_HEADERS_SENT(): Error;
declare function $ERR_HTTP2_INVALID_STREAM(): Error;
declare function $ERR_HTTP2_NO_SOCKET_MANIPULATION(): Error;
declare function $ERR_HTTP2_SOCKET_UNBOUND(): Error;
declare function $ERR_HTTP2_MAX_PENDING_SETTINGS_ACK(): Error;
declare function $ERR_HTTP2_INVALID_SESSION(): Error;
declare function $ERR_HTTP2_TRAILERS_ALREADY_SENT(): Error;
declare function $ERR_HTTP2_TRAILERS_NOT_READY(): Error;
declare function $ERR_HTTP2_SEND_FILE(): Error;
declare function $ERR_HTTP2_SEND_FILE_NOSEEK(): Error;
declare function $ERR_HTTP2_PUSH_DISABLED(): Error;
declare function $ERR_HTTP2_HEADERS_AFTER_RESPOND(): Error;
declare function $ERR_HTTP2_STATUS_101(): Error;
declare function $ERR_HTTP2_ALTSVC_INVALID_ORIGIN(): TypeError;
declare function $ERR_HTTP2_INVALID_ORIGIN(): TypeError;
declare function $ERR_HTTP2_ALTSVC_LENGTH(): TypeError;
declare function $ERR_HTTP2_PING_LENGTH(): RangeError;
declare function $ERR_HTTP2_OUT_OF_STREAMS(): Error;
declare function $ERR_HTTP_BODY_NOT_ALLOWED(): Error;
declare function $ERR_HTTP_SOCKET_ASSIGNED(): Error;
declare function $ERR_DIR_CLOSED(): Error;
declare function $ERR_INVALID_MIME_SYNTAX(production: string, str: string, invalidIndex: number | -1): TypeError;

/**
 * Convert a function to a class-like object.
 *
 * This does:
 * - Sets the name of the function to the given name
 * - Sets .prototype to Object.create(base?.prototype, { constructor: { value: fn } })
 * - Calls Object.setPrototypeOf(fn, base ?? Function.prototype)
 *
 * @param fn - The function to convert to a class
 * @param name - The name of the class
 * @param base - The base class to inherit from
 */
declare function $toClass(fn: Function, name: string, base?: Function | undefined | null);

declare function $min(a: number, b: number): number;

declare function $checkBufferRead(buf: Buffer, offset: number, byteLength: number): undefined;

/**
 * Schedules a callback to be invoked as a microtask.
 */
declare function $enqueueJob<T extends (...args: any[]) => any>(callback: T, ...args: Parameters<T>): void;

declare function $rejectPromise(promise: Promise<unknown>, reason: unknown): void;
declare function $resolvePromise(promise: Promise<unknown>, value: unknown): void;

interface Map<K, V> {
  $get: typeof Map.prototype.get;
  $set: typeof Map.prototype.set;
}

interface ObjectConstructor {
  $defineProperty: typeof Object.defineProperty;
  $defineProperties: typeof Object.defineProperties;
}

declare const $Object: ObjectConstructor;

/** gets a property on an object */
declare function $getByIdDirect<T = any>(obj: any, key: string): T;

/**
 * Gets a private property on an object.
 * Translates to the `op_get_by_id_direct` bytecode.
 *
 * @param obj The object to get the private property from
 * @param key The key of the private property (without the "$" prefix)
 * @returns The value of the private property
 */
declare function $getByIdDirectPrivate<T = any, K extends string = string>(
  obj: T,
  key: K,
): K extends keyof T ? T[`$${K}`] : T extends { [P in `$${K}`]: infer V } ? V : never;

declare var $Promise: PromiseConstructor;

declare function $isPromise<T>(value: unknown): value is Promise<T>;

declare type $ReadableStream = ReadableStream;
declare type $ReadableStreamBYOBReader = ReadableStreamBYOBReader;
declare type $ReadableStreamDefaultReader = ReadableStreamDefaultReader;
declare type $ReadableStreamDefaultController = ReadableStreamDefaultController;
declare type $ReadableStreamDirectController = ReadableStreamDirectController;
