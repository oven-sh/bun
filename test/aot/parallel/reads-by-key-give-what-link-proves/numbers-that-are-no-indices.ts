// numbers that are no indices
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }, { v: 2 }); (list as any)[-1] = "under minus one"; (list as any)[0.5] = "under a half"; (list as any)[4294967295] = "past the last index";
for (let k = -1; k < 2; k += 0.5) out.push(say(list[k]));
for (let k = 4294967294; k < 4294967297; k++) out.push(say(list[k]));
console.log(out.join(" | "));
