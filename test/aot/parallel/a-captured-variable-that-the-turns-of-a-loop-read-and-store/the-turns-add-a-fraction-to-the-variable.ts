const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let total = 0; return { run(turns: number, by: number) { for (let i = 0; i < turns; i++) total += by; return total; }, flip(turns: number) { for (let i = 0; i < turns; i++) total = 5 - total; return total; }, get: () => total }; }
const m = make();
console.log(m.run(n(4), n(0.5)), m.run(n(3), n(2)), m.flip(n(3)), m.get());
