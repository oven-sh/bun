const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
type Item = { skip?: boolean; weight: number; seen: number; last?: number };
const items: Item[] = [{ weight: 1, seen: 0 }, { weight: 2, seen: 0, skip: false }, JSON.parse('{"weight":3,"seen":0}'), { weight: 4, seen: 0, skip: true }, { weight: 5, seen: 0 }];
const tools = { round: Math.floor };
const hide: (x: unknown) => void = (0, eval)("(x) => {}");
hide(tools);
const holder: { walk?: Walk } = { };
function spoil(walk: Walk, at: number): number { if (at === 2) { let k = 0; (walk as any).next = function () { const n = k++; return { value: "spoiled " + n, done: n > 1 }; }; } return at; }
type Carrier = { walk?: Walk; sent: number };
const carriers: Carrier[] = [{ sent: 1 }, JSON.parse('{"sent":2}'), { sent: 3 }];
function weightOf(item: Item): number { if (item.skip) return 0; return item.weight; }
function relink(walk: Walk): number { Object.setPrototypeOf(walk, (walkOf as any).prototype); return 1; }
function mend(walk: Walk, at: number): number { if (at === 1) { delete (walk as any).next; Object.setPrototypeOf(walk, (walkOf as any).prototype); } return at; }
function prepare(walk: Walk, round: number): Walk { if (round & 1) { let k = 0; Object.setPrototypeOf(walk, { next() { const at = k++; return { value: "swapped " + at, done: at > 1 }; } }); } return walk; }
function take(at: number, walk: Walk): string { const item = items[at % items.length]; if (item.skip) return "skipped"; const sent = item.weight; const value = walk.next(sent)?.value;  return "" + value;  }
function drive(walk: Walk): string { let out = ""; for (let at = 0; at < 9; at++) { const got = take(at, walk); out += got + ","; if (got[0] === "|") break; } return out; }
for (let turn = 0; turn < 300; turn++) {
  const round = turn % 6;
  if (turn >= 6) log.length = 0;
  holder.walk = undefined;
  const walk = prepare(walkOf(4 + round), round);
  let said: string; try { said = drive(walk); } catch (e) { said = "thrown: " + (e as Error).name; }
  log.push(round + ": " + said);
  if (turn < 6 || turn >= 294) console.log(log.join("\n"));
}
