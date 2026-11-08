function gather(items: unknown[], pick: boolean, ask: (x: unknown, into: unknown[], at: number) => unknown): unknown[] {
  const shown = pick ? [] : items.slice(0, 1);
  for (let i = 0; i < items.length; i++) shown.push(ask(items[i], shown, i));
  return shown;
}
(globalThis as any).gatherers = [gather];
function tell(list: unknown): string { try { return JSON.stringify(list) + ":" + (list as unknown[]).length; } catch (error) { return (error as Error).constructor.name; } }
function run(deed: (x: unknown, into: unknown[], at: number) => unknown): string {
  let said = "";
  for (let k = 0; k < 40; k++) gather([1, 2, 3], k % 2 === 0, (x) => x);
  for (const pick of [true, false]) { try { said += tell(gather([1, 2, 3, 4, 5, 6], pick, deed)) + " "; } catch (error) { said += (error as Error).constructor.name + ":" + (error as Error).message.slice(0, 40) + " "; } }
  return said;
}
console.log(run((x, into, at) => { if (at === 2) (into as any).push = function (v: unknown) { return Array.prototype.push.call(this, "mine:" + v); }; return x; }));
