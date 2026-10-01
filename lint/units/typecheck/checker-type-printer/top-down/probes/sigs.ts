interface Foo { a: string }
declare function f1(a: string, b?: number, ...rest: boolean[]): void;
declare function f2<T extends Foo, K extends keyof T = keyof T>(this: Foo, x: T, k: K): x is T;
declare function f3(x = 1, y: number): asserts x;
declare const f4: new (x: number) => Foo;
declare const f5: abstract new () => Foo;
declare const f6: { (x: string): void; new (y: number): Foo; readonly p: 1; q?: "s"; [k: string]: unknown; m(): void; "quoted-name": 1; 0: string; get acc(): number; set acc(v: string) };
let n: number;
n = f1; n = f2; n = f3; n = f4; n = f5; n = f6;
