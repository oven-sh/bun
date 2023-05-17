// Typedefs for JSC intrinsics. Instead of @, we use $

/** Place this directly above a function declaration (like a decorator) to make it a getter. */
declare const $getter: never;
/** Assign to this directly above a function declaration (like a decorator) to override the function's display name. */
declare var $overriddenName: string;
/** ??? */
declare var $linkTimeConstant: never;

//
declare function $extractHighWaterMarkFromQueuingStrategyInit(obj: any): any;

// JSC defines their intrinsics in a nice list here:
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecode/BytecodeIntrinsicRegistry.h
//
// And implemented here: (search for "emit_intrinsic_<name>", like "emit_intrinsic_arrayPush")
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/bytecompiler/NodesCodegen.cpp

/** Assert a value is true */
declare function $assert(index: any): void;
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
declare function $tailCallForwardArguments(): TODO;
declare function $throwTypeError(message: string): never;
declare function $throwRangeError(message: string): never;
declare function $throwOutOfMemoryError(): never;
declare function $tryGetById(): TODO;
declare function $tryGetByIdWithWellKnownSymbol(): TODO;
declare function $putByIdDirect(obj: any, key: string, value: any): void;
declare function $putByIdDirectPrivate(obj: any, key: string, value: any): void;
declare function $putByValDirect(): TODO;
declare function $putByValWithThisSloppy(): TODO;
declare function $putByValWithThisStrict(): TODO;
declare function $putPromiseInternalField(): TODO;
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
declare function $newArrayWithSize(): TODO;
declare function $newArrayWithSpecies(): TODO;
declare function $newPromise(): TODO;
declare function $createPromise(): TODO;

// The following I cannot find any definitions of, but they are functional.
declare function $toLength(length: number): number;

declare const $promiseFieldFlags: unique symbol;
declare const $promiseFieldReactionsOrResult: unique symbol;
type PromiseField = typeof $promiseFieldFlags | typeof $promiseFieldReactionsOrResult;
type PromiseFieldToValue<X extends PromiseField, V> = X extends typeof $promiseFieldFlags
  ? number
  : X extends typeof $promiseFieldReactionsOrResult
  ? V
  : never;

// You can also `@` on some/all methods on classes to avoid prototype pollution.

declare interface Map<K, V> {
  $set(key: K, value: V): void;
  $get(key: K): V | undefined;
}
declare interface CallableFunction extends Function {
  /**
   * Calls the function with the specified object as the this value and the elements of specified array as the arguments.
   * @param thisArg The object to be used as the this object.
   * @param args An array of argument values to be passed to the function.
   */
  $apply<T, R>(this: (this: T) => R, thisArg: T): R;
  $apply<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, args: A): R;

  /**
   * Calls the function with the specified object as the this value and the specified rest arguments as the arguments.
   * @param thisArg The object to be used as the this object.
   * @param args Argument values to be passed to the function.
   */
  $call<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A): R;
}
declare interface Promise<T> {
  $then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2>;
  $catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult>;
}

declare class OutOfMemoryError {
  constructor();
}

// Inlining our enum types
declare const $ImportKindIdToLabel: Array<import("bun").ImportKind>;
declare const $ImportKindLabelToId: Record<import("bun").ImportKind, number>;
declare const $LoaderIdToLabel: Array<import("bun").Loader>;
declare const $LoaderLabelToId: Record<import("bun").Loader, number>;
