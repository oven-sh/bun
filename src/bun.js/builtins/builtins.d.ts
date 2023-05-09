/** Place this directly above a function declaration (like a decorator) to make it a getter. */
declare const $getter: never;
/** Assign to this directly above a function declaration (like a decorator) to override the function's display name. */
declare var $overriddenName: string;

declare function $putByIdDirectPrivate(obj: any, key: string, value: any): void;
declare function $getByIdDirectPrivate<T = any>(obj: any, key: string): T;
declare function $extractHighWaterMarkFromQueuingStrategyInit(obj: any): any;
declare function $isPromise(obj: unknown): obj is Promise<unknown>;
declare function $toLength(length: number): number;
declare function $argumentCount(): number;
declare function $argument<T = any>(i: number): T;

declare interface Map<K, V> {
  $set(key: K, value: V): void;
  $get(key: K): V | undefined;
}
