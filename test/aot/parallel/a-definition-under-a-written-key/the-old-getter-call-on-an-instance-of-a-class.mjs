class A { a = 1; b = 2; }
const o = new A;
function act() {
o.__defineGetter__("a", function () { this.b = "text"; return "text"; });
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
