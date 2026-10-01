interface A { a: { b: { c: number } }; f(): { x: number }; }
const v1: A = { a: { b: { c: "s" } }, f() { return { x: 1 }; } };
declare const src: { a: { b: { c: string } }; f(): { x: string } };
const v2: A = src;
const v3: { x: number } = { x: 1, y: 2 };
const v4: number[] = [1, "s", 3];
const v5: () => number = () => "s";
const v6: { p: number }[] = [{ p: 1 }, { p: "s" }];
declare let fn0: () => number;
const v7: number = fn0;
