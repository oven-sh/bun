function lazy(make) { return () => make(); }
function build(isFirst, other) { const made = {}; if (isFirst) Object.defineProperty(made, "part", { get: function () { return 1; } }); else Object.defineProperty(made, "part", { get: other }); return made; }
const one = build(true, null), two = build(false, lazy(() => 7));
function use(holder) { let sum = 0; for (let i = 0; i < 50; i++) sum += holder.part; return sum; }
let said = 0; for (let turn = 0; turn < 400; turn++) said += use(turn & 1 ? one : two);
console.log(said);
