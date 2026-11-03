// Objects, environments and the frames of async functions are born with most of their slots empty, in code that runs seldom: cells of every size up to 80 bytes and larger ones,
// slots that hold references, numbers, flags and closures. Cells die between the births, so a new cell lies where an old one held values.
// Every field that nobody stored reads as absent, by name, by `in`, in the order of keys and in a copy.
// Flags: --aot-heat=nothing-is-hottest
interface Small { a?: string; b?: object; c?: number }
interface Medium { a?: string; b?: object; c?: number; d?: boolean; e?: string[]; f?: () => number; g?: Small; h?: string }
interface Large extends Medium {
  i?: string; j?: object; k?: number; l?: boolean; m?: string[]; n?: () => number; o?: Small; p?: string;
  q?: string; r?: object; s?: number; t?: boolean; u?: string[]; v?: () => number; w?: Small; x?: string;
}
function describe(object: object): string {
  const record = object as Record<string, unknown>;
  const names = "abcdefghijklmnopqrstuvwx".split("");
  const present = names.filter(name => name in record);
  const defined = names.filter(name => record[name] !== undefined);
  return `${Object.keys(object).join("")}|${present.join("")}|${defined.join("")}|${JSON.stringify({ ...object })}`;
}
function fill(turn: number): unknown[] {
  const kept: unknown[] = [];
  for (let i = 0; i < 400; i++) {
    const text = "t" + turn + i;
    const full: Large = {
      a: text, b: [i], c: i + 0.5, d: true, e: [text], f: () => i, g: { a: text, b: {}, c: i }, h: text,
      i: text, j: [i], k: i + 0.5, l: true, m: [text], n: () => i, o: { a: text, b: {}, c: i }, p: text,
      q: text, r: [i], s: i + 0.5, t: true, u: [text], v: () => i, w: { a: text, b: {}, c: i }, x: text,
    };
    const medium: Medium = { a: text, b: [i], c: i + 0.5, d: false, e: [text], f: () => i, g: { c: i }, h: text };
    if (i % 97 === 0) kept.push(full, medium);
  }
  return kept;
}
function small(turn: number): Small[] { return [{}, { a: "a" + turn }, { c: turn }, { b: [turn] }]; }
function medium(turn: number): Medium[] { return [{}, { h: "h" + turn }, { c: turn + 0.25 }, { d: turn % 2 === 0 }, { f: () => turn }, { a: "a", e: ["e" + turn] }]; }
function large(turn: number): Large[] { return [{}, { x: "x" + turn }, { k: turn + 0.25, s: turn }, { l: true, t: false }, { n: () => turn }, { a: "a", m: ["m" + turn], w: { c: turn } }]; }
function counters(turn: number): (() => number)[] {
  let first: number | undefined, second: string | undefined, third: object | undefined, fourth: number[] | undefined, fifth: (() => number) | undefined, sixth: string | undefined;
  return [
    () => (first === undefined ? 0 : 1) + (second === undefined ? 0 : 2) + (third === undefined ? 0 : 4) + (fourth === undefined ? 0 : 8) + (fifth === undefined ? 0 : 16) + (sixth === undefined ? 0 : 32),
    () => { first = turn; fourth = [turn]; return 0; },
    () => { second = "s"; third = {}; fifth = () => turn; sixth = "x"; return 0; },
  ];
}
async function waits(turn: number): Promise<string> {
  let first: string | undefined, second: object | undefined, third: number[] | undefined, fourth: string | undefined, fifth: object | undefined, sixth: string | undefined;
  await null;
  const before = [first, second, third, fourth, fifth, sixth].filter(value => value !== undefined).length;
  if (turn % 2) { first = "f" + turn; third = [turn]; }
  await null;
  if (turn % 3 === 0) { second = {}; sixth = "s"; }
  await null;
  return before + ":" + [first, second, third, fourth, fifth, sixth].map(value => (value === undefined ? "-" : typeof value)[0]).join("");
}
const lines = new Set<string>();
let kept = 0;
for (let turn = 0; turn < 12; turn++) {
  kept += fill(turn).length;
  if (turn % 4 === 3) Bun.gc(true);
  for (const object of [...small(turn % 2), ...medium(turn % 2), ...large(turn % 2)]) lines.add(describe(object));
  const [state, one, two] = counters(turn);
  const states = [state()];
  one(); states.push(state());
  two(); states.push(state());
  lines.add("environment " + states.join(" "));
  lines.add("frame " + (await waits(turn % 6)));
}
console.log(kept);
for (const line of [...lines].sort()) console.log(line);
