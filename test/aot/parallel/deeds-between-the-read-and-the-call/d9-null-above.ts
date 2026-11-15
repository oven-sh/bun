function gather(items: unknown[], pick: boolean, ask: (x: unknown, into: any, at: number) => unknown): unknown[] {
  const shown = pick ? [] : items.slice(0, 1);
  for (let i = 0; i < items.length; i++) shown.push(ask(items[i], shown, i));
  return shown;
}
function tell(list: unknown[]): string { return Array.prototype.slice.call(list, -4).map(String).join() + ":" + list.length; }
function run(deed: (x: unknown, into: any, at: number) => unknown): string {
  let said = "";
  for (let k = 0; k < 40; k++) gather([1, 2, 3], k % 2 === 0, (x) => x);
  for (const pick of [true, false]) { try { said += tell(gather([1, 2, 3, 4, 5, 6], pick, deed)) + " "; } catch (error) { said += (error as Error).name + " "; } }
  return said;
}
console.log(run((x, into, at) => { if (at === 3) { Object.setPrototypeOf(into, null); } return x; }));
