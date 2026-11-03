// What a package's declaration file would say of the addon, for classes-and-callbacks.ts.
export interface CounterLike { increment(by?: number): number; value: number }
export interface Addon {
  Counter: { new (start?: number): CounterLike; made(): number; prototype: CounterLike };
  call(self: unknown, f: Function, argument: unknown): unknown; callMethod(o: object, name: string, argument: unknown): unknown; valueAt(o: object, name: string): string; makeExternal(): unknown;
  names(o: object): string[]; unwrap(o: object): number | string; instanceOf(o: unknown, c: Function): boolean; fill<T extends object>(o: T): T; addFinalizer(o: object): string; finalizedSoFar(): number; typeOf(v: unknown): string;
  allNames(o: object, mode: number, filter: number, conversion: number): (string | symbol)[]; construct(c: Function, a: unknown, b: unknown): unknown;
}
