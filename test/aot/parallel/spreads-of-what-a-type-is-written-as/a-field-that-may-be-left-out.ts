type Named = { name: string; size?: number };
function first(named: Named, more: boolean) { return { ...named, more }; }
function second(named: Named) { return { ...named }; }
function third(named: Named, name: string) { return { ...named, name }; }
(globalThis as any).keep = [first, second, third];
const [wider, again, renamed]: [typeof first, typeof second, typeof third] = (globalThis as any).keep;
(globalThis as any).literal = [{ name: "", more: true }, { name: "", size: 0, more: false }];
const short: Named = { name: "n" };
const long: Named = { name: "m", size: 3 };
const turned: Named = { size: 4, name: "o" };
const given: Named = { name: "p", size: undefined };
for (const named of [short, long, turned, given])
  console.log(JSON.stringify(wider(named, true)), Object.keys(wider(named, false)).join(), JSON.stringify(again(named)), Object.keys(again(named)).join(), again(named) === named, JSON.stringify(renamed(named, "r")), Object.keys(renamed(named, "r")).join());
