declare const Bun: { gc(force: boolean): void };
const mine = function (): string { return "mine"; };
const doors: Record<string, (r: any) => Generator<string, unknown, number>> = {
  *adds(r: number[]) { return r.push(yield "adds"); },
  *cuts(r: string) { return r.substring(yield "cuts", 4); },
  *sets(r: Map<number, number>) { return r.set(1, yield "sets") === r; },
  *joins(r: Set<number>) { return r.add(yield "joins") === r; },
};
async function later(r: number[], p: Promise<number>): Promise<number> { return r.push(await p); }
const kinds: Record<string, () => any> = { adds: () => [1, 2], cuts: () => "alphabet", sets: () => new Map([[1, 1]]), joins: () => new Set([1]) };
const changes: Record<string, (r: any) => void> = {
  none() {}, collects() { Bun.gc(true); },
  lays(r) { if (typeof r === "object") r.push = r.set = r.add = mine; },
  chain(r) { if (typeof r === "object") Object.setPrototypeOf(r, { push: mine, set: mine, add: mine }); },
};
const names: string[] = JSON.parse('["adds","cuts","sets","joins"]'), said: string[] = [];
for (const name of names) for (const change in changes) for (let turn = 0; turn < 2; turn++) {
  const r = kinds[name]!(), run = doors[name]!(r);
  run.next(); changes[change]!(r); said.push(name + "." + change + "=" + String(run.next(3).value));
}
const list = [1, 2], answer = later(list, Promise.resolve(3)); (list as any).push = mine; Bun.gc(true);
console.log("SAID", said.join(" "), "later=" + (await answer));
export {};
