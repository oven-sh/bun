const o = { a: 1, b: 2 };
function act() {
Object.defineProperty(o, "a", { value: 1, enumerable: false });
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
