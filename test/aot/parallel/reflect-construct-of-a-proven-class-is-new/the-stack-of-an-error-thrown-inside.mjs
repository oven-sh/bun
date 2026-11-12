class P { constructor(x) { this.lines = new Error("here").stack.split("\n").slice(0, 3).map((l) => l.replace(/\(.*[\\/]/, "(").trim()).join(" < "); } }
function make() { return Reflect.construct(P, [1]); }
console.log(make().lines);
