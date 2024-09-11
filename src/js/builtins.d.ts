/// <reference types="../../build/codegen/generated.d.ts" />
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
/** $assert is a preprocessor macro that only runs in debug mode. it throws an error if the first argument is falsy.
 * The source code passed to `check` is inlined in the message, but in addition you can pass additional messages.
 */
declare function $assert(check: any, ...message: any[]): asserts check;

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

// JSC defines their intrinsics in a nice list here:
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecode/BytecodeIntrinsicRegistry.h
//
// And implemented here: (search for "emit_intrinsic_<name>", like "emit_intrinsic_arrayPush")
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecompiler/NodesCodegen.cpp

/** returns `arguments[index]` */
declare function $argument<T = any>(index: number): any;
/** returns number of arguments */
declare function $argumentCount(): number;
/** array.push(item) */
declare function $arrayPush(array: T[], item: T): void;
/** gets a property on an object */
declare function $getByIdDirect<T = any>(obj: any, key: string): T;
/**
 * gets a private property on an object. translates to the `op_get_by_id_direct` bytecode.
 *
 * TODO: clarify what private means exactly.
 */
declare function $getByIdDirectPrivate<T = any>(obj: any, key: string): T;
/**
 * gets a property on an object
 */
declare function $getByValWithThis(target: any, receiver: any, propertyKey: string): void;
/** gets the prototype of an object */
declare function $getPrototypeOf(value: any): any;
/** gets an internal property on a promise
 *
 *  You can pass
 *  - $promiseFieldFlags - get a number with flags
 *  - $promiseFieldReactionsOrResult - get the result (like Bun.peek)
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
declare function $evaluateCommonJSModule(...args: any[]): TODO;
declare function $loadCJS2ESM(...args: any[]): TODO;
declare function $getGeneratorInternalField(): TODO;
declare function $getAsyncGeneratorInternalField(): TODO;
declare function $getAbstractModuleRecordInternalField(): TODO;
declare function $getArrayIteratorInternalField(): TODO;
declare function $getStringIteratorInternalField(): TODO;
declare function $getMapIteratorInternalField(): TODO;
declare function $getSetIteratorInternalField(): TODO;
declare function $getProxyInternalField(): TODO;
declare function $idWithProfile(): TODO;
declare function $isObject(obj: unknown): obj is object;
declare function $isArray(obj: unknown): obj is any[];
declare function $isCallable(fn: unknown): fn is CallableFunction;
declare function $isConstructor(fn: unknown): fn is { new (...args: any[]): any };
declare function $isJSArray(obj: unknown): obj is any[];
declare function $isProxyObject(obj: unknown): obj is Proxy;
declare function $isDerivedArray(): TODO;
declare function $isGenerator(obj: unknown): obj is Generator<any, any, any>;
declare function $isAsyncGenerator(obj: unknown): obj is AsyncGenerator<any, any, any>;
declare function $isPromise(obj: unknown): obj is Promise<any>;
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
declare function $putByIdDirectPrivate(obj: any, key: PropertyKey, value: any): void;
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
declare function $newArrayWithSize<T>(size: number): T[];
declare function $newArrayWithSpecies(): TODO;
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
declare function $internalRequire(path: string): TODO;
declare function $internalStream(): TODO;
declare function $internalWritable(): TODO;
declare function $isAbortSignal(signal: unknown): signal is AbortSignal;
declare function $isAbsolute(): TODO;
declare function $isDisturbed(): TODO;
declare function $isPaused(): TODO;
declare function $isWindows(): TODO;
declare function $join(): TODO;
declare function $kind(): TODO;
declare function $lazyStreamPrototypeMap(): TODO;
declare function $loadModule(): TODO;
declare function $localStreams(): TODO;
declare function $main(): TODO;
declare function $makeDOMException(): TODO;
declare function $makeGetterTypeError(className: string, prop: string): Error;
declare function $makeThisTypeError(className: string, method: string): Error;
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
declare const $requireMap: Map<string, CommonJSModuleRecord>;
declare const $internalModuleRegistry: InternalFieldObject<any[]>;
declare function $resolve(name: string, from: string): Promise<string>;
declare function $resolveSync(name: string, from: string, isESM?: boolean): string;
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
  parent: CommonJSModuleRecord,
): CommonJSModuleRecord;

declare function $overridableRequire(this: CommonJSModuleRecord, id: string): any;

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

declare var $Buffer: {
  new (a: any, b?: any, c?: any): Buffer;
};

declare interface Error {
  code?: string;
}

/**
 * -- Error Codes with manual messages
 */
declare function $ERR_INVALID_ARG_TYPE(argName: string, expectedType: string, actualValue: string): TypeError;
declare function $ERR_INVALID_ARG_TYPE(argName: string, expectedTypes: any[], actualValue: string): TypeError;
