const o = { a: 1, b: 2 };
function act() {
o.__defineSetter__("a", function (v) { this.b = v; });
o.a = "text";
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
