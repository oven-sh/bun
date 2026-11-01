// Literals that only look like a class are handed where the class is declared. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Point { x = 1; y = 2; norm(): number { return this.x + this.y; } }
function f35(p: Point): unknown { return [p.x + p.y, p.norm()]; }
for (let i = 0; i < 30; i++) f35(new Point()); const like: Point = { y: 20, x: 10, norm() { return -1; } }; const more = { x: "s" as unknown as number, y: 1, norm: () => 0, z: 1 }; show(f35(like), f35(more));
export {};
