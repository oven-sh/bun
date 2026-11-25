export {};
interface Source { x: number | string; y: number }
interface Copy extends Source { own: number | boolean }
function first(a: Source): Copy { return { ...a, own: 1 }; }
function second(a: Source): Copy { return { ...a, own: true }; }
function third(a: Source): Copy { return { own: 3, ...a }; }
function same(a: Source): Source { return { ...a, y: a.y + 1 }; }
function late(a: Source): void { a.x = "text"; }
function read(c: Source): string { return typeof c.x === "number" ? "number " + (c.x + 1) : "text " + c.x.length; }
const source: Source = { x: 1, y: 2 };
console.log(read(first(source)), read(second(source)), read(third(source)), read(same(source)), first(source).own, second(source).own, third(source).own, same(source).y);
late(source);
console.log(read(first(source)), read(second(source)), read(third(source)), read(same(source)), read(same(first(source))), read(first(same(source))));
