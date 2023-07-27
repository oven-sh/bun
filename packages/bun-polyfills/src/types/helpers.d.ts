type AnyFunction = (...args: any[]) => any;
type AnyClass = new (...args: any[]) => any;
type AnyCallable = AnyFunction | AnyClass;

type MapKeysType<T extends Map<unknown, unknown>> = T extends Map<infer K, infer V> ? K : never;
type MapValuesType<T extends Map<unknown, unknown>> = T extends Map<infer K, infer V> ? V : never;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
