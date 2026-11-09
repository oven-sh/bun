function gather(items: unknown[], pick: boolean, ask: (x: unknown, into: unknown[], at: number) => unknown): unknown[] {
  const shown = pick ? [] : items.slice(0, 1);
  for (let i = 0; i < items.length; i++) shown.push(ask(items[i], shown, i));
  return shown;
}
(globalThis as any).gatherers = [gather];
const plain = gather([1, 2, 3], false, (x) => x);
function pushOfMine(this: unknown[], v: unknown): number { return Array.prototype.push.call(this, "mine:" + v); }
const above = { push: pushOfMine };
const other = gather([1, 2, 3, 4], true, (x, into, at) => { if (at === 1) Object.setPrototypeOf(into, above); return x; });
let said = "";
try { gather([1, 2, 3], true, (x, into, at) => { if (at === 1) Object.freeze(into); return x; }); } catch (error) { said = (error as Error).constructor.name; }
console.log(plain.join(), Array.prototype.join.call(other), said);
