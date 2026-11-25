// Forty statements in one loop call what a map has just given. At turn 20 a function that the build does not see takes the entry away: the call throws, and the throw is caught out of sight.
type Thing = { id: number; payload: number[] };
let made = 0, sum = 0;
const turns: number = JSON.parse("40");
function make(): Thing { return { id: ++made, payload: [made, made] }; }
function use(thing: Thing | null | undefined, more: number): void { sum += (thing?.payload.length ?? 0) + more; }
function other(): number { sum += made; return sum & 1; }
const unseen = new Map<string, () => void>([["tick", () => { sum++; }]]);
let caught = 0;
const deeds: Record<string, (turn: number) => void> = { quiet() {}, miss(turn) { if (turn === 20) { unseen.delete("tick"); } } };
const deed = deeds[JSON.parse('"miss"')];
function first(x: Thing | null, more: number): boolean { use(x, 0); use(x, more); x = null; unseen.get("tick")!(); return made > 3; }
function long(): boolean {
  let all = true;
  for (let i = 0; i < turns; i++) {
    deed(i);
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
    all = first(make(), other() + i) && all;
  }
  return all;
}
const run = new Function("f", "try { return String(f()); } catch (error) { return error.constructor.name; }") as (f: () => unknown) => string;
const heard = run(long);
for (const word of [heard, made, sum, caught, typeof unseen.get("tick")]) console.log("SAID", typeof word, String(word));
export {};
