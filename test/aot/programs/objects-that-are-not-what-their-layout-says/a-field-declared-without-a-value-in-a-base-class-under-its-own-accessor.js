// the same in a base class, and the accessor lies on the class's own prototype object
const log = [];
class A { n; s; constructor(seed) { this.n = seed + 0.5; this.s = "s" + seed; } }
function show(v) { return [v.n, v.s, Object.keys(v).join(), typeof Object.getOwnPropertyDescriptor(v, "n")?.value].join(" "); }
let warm = 0; for (let i = 0; i < 300; i++) warm += new A(i).n; console.log(warm);
Object.defineProperty(A.prototype, "n", { configurable: true, get() { return "from above"; }, set(value) { log.push("set n " + value); } });
console.log(show(new A(3)), log.join());
