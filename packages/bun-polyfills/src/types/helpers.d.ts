type AnyFunction = (...args: any[]) => any;
type AnyClass = new (...args: any[]) => any;
type AnyCallable = AnyFunction | AnyClass;

type MapKeysType<T extends Map<unknown, unknown>> = T extends Map<infer K, infer V> ? K : never;
type MapValuesType<T extends Map<unknown, unknown>> = T extends Map<infer K, infer V> ? V : never;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Excluding the BigInt typed arrays */
type TypedArrayConstructor = 
    | typeof Uint8Array | typeof Uint16Array | typeof Uint32Array | typeof Uint8ClampedArray
    | typeof Int8Array | typeof Int16Array | typeof Int32Array | typeof Float32Array | typeof Float64Array;
