type Plan = { first: number; second: number };
function widen(plan: Plan, third: number) { return { ...plan, third }; }
function widenTwice(plan: Plan, third: number) { const once = widen(plan, third); return { ...widen(once, third + 1), fourth: once.third }; }
const narrow: Plan = { first: 1, second: 2 };
const turned: Plan = { second: 5, first: 4 };
const wide = { first: 7, second: 8, third: 9, more: "m" };
const odd: any = { second: "s", first: null };
(globalThis as any).kept = [narrow, turned, wide, odd];
(0, eval)("1");
const bound = Number((globalThis as any).process?.argv?.[2] ?? 40);
const said: string[] = [];
for (const plan of [narrow, turned, wide, odd] as Plan[]) {
  let last: unknown = null, total = 0;
  for (let i = 0; i < bound; i++) { const wider = widen(plan, i & 7); total += Number(wider.first) + wider.third; last = widenTwice(plan, i); }
  said.push(total + " " + JSON.stringify(last) + " " + Object.keys(last as object).join());
}
delete (narrow as any).first;
(turned as any).added = 1;
for (const plan of [narrow, turned]) { let last: unknown = null; for (let i = 0; i < bound; i++) last = widen(plan, i); said.push(JSON.stringify(last)); }
console.log(said.join("\n"));
