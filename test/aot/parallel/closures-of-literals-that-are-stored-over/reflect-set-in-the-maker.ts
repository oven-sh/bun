type Holder = { get: () => number; other?: () => number };
function hold(start: number, from: Holder | undefined): Holder { let count = start; const made: Holder = { get: () => count++ }; if (from) Reflect.set(made, "get", from.get); return made; }
function drain(list: Holder[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]!.get(); return total; }
const list: Holder[] = [];
for (let i = 0; i < 300; i++) list.push(hold(1000 * i, i ? list[0] : undefined));
console.log(drain(list), drain(list), list[7]!.get === list[0]!.get, list[7]!.get());
