const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; return { more: (limit: number) => pos < limit, step() { pos++; }, get: () => pos }; }
type S = ReturnType<typeof make>;
function both(x: S, y: S, limit: number) { let turns = 0; while (x.more(limit) && y.more(limit)) { x.step(); y.step(); turns++; } return turns; }
const a = make(), b = make(), list = [a, b];
console.log(both(list[n(0)], list[n(0)], 10), a.get(), both(list[n(0)], list[n(1)], 20), a.get(), b.get());
