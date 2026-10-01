interface Point { x: number; y?: string; readonly z: boolean; [key: `data-${string}`]: unknown; }
interface Box<T> extends Point { value: T; map<U>(f: (x: T) => U): Box<U>; new (v: T): Box<T>; (): T; }
interface Point { w: bigint; }
declare class Animal { name: string; static count: number; protected legs: number; constructor(name: string); speak(loud?: boolean): void; }
declare class Dog<T extends object = {}> extends Animal implements Point { x: number; z: boolean; w: bigint; tag: T; fetch(): this; }
declare enum Color { Red, Green = 4, Blue }
declare const enum Flag { A = "a", B = "b" }
type Pair<A, B = A> = [A, B];
type Named = [first: string, second?: number, ...rest: boolean[]];
type Keys = keyof Point;
type Lookup = Point["x"] | Box<string>["value"];
type Cond<T> = T extends string ? "s" : T extends number ? "n" : never;
type Mapped<T> = { readonly [P in keyof T]?: T[P] };
type Tpl = `id-${number}` | Uppercase<"ab">;
type Inter = Point & { extra: symbol };
type Fn = { (a: number): string; (a: string, ...b: number[]): void };
type Ctor = abstract new () => Animal;
type Rec = { next: Rec | null; items: Rec[] };
declare const p: Point;
declare const b: Box<number>;
declare const d: Dog<{ id: 1 }>;
declare const c: Color.Green;
declare const f: Flag;
declare const pair: Pair<string>;
declare const named: Named;
declare const keys: Keys;
declare const look: Lookup;
declare const cond: Cond<"a" | 1 | true>;
declare const mapped: Mapped<Point>;
declare const tpl: Tpl;
declare const inter: Inter;
declare const fn: Fn;
declare const ctor: Ctor;
declare const rec: Rec;
declare function over(a: number): string;
declare function over(a: string): number;
declare function generic<T, U extends keyof T>(obj: T, key: U): T[U];
declare function guard(x: unknown): x is string;
declare function asserts(x: unknown): asserts x;
