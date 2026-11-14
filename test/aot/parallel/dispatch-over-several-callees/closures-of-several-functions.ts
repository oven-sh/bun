const out: string[] = [];
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v instanceof Error ? v.name + " " + v.message : typeof v === "object" && v ? "object" : String(v);
type Handler = (n: number) => number;
let shared = 0;
function makeHandler(kind: number): Handler {
  let calls = 0;
  switch (kind) {
    case 0: return n => n + ++calls;
    case 1: return n => (n ^ kind) + ++calls;
    case 2: return n => n * 3 - ++calls;
    default: return n => n - kind;
  }
}
function four(): Handler[] { const list: Handler[] = []; for (let k = 0; k < 16; k++) list.push(makeHandler(k & 3)); return list; }
function odd(at: number, value: unknown): Handler[] { const list = four(); (list as unknown[])[at] = value; return list; }
function marked(from: number): Handler[] { const list = four(); for (let k = from; k < list.length; k++) Object.assign(list[k], { mark: k }); return list; }
const lists: [string, () => Handler[]][] = [
  ["four", four],
  ["one is marked", () => { const list = four(); Object.assign(list[6], { mark: 1 }); return list; }],
  ["half are marked", () => marked(8)],
  ["all are marked", () => marked(0)],
  ["undefined", () => odd(5, undefined)],
  ["null", () => odd(9, null)],
  ["a number", () => odd(3, 7)],
  ["a string", () => odd(3, "handler")],
  ["a built-in", () => odd(7, Math.sqrt)],
  ["a bound function", () => odd(2, makeHandler(0).bind(null))],
  ["a proxy", () => odd(4, new Proxy(makeHandler(2), {}))],
  ["another closure", () => odd(11, (n: number) => n / 4)],
  ["gives a string", () => odd(12, (n: number) => "s" + n)],
  ["gives a bigint", () => odd(13, (n: number) => 1n)],
  ["throws", () => odd(14, (n: number) => { throw new RangeError("n is " + n); })],
  ["an async function", () => odd(1, async (n: number) => n)],
  ["a class", () => odd(1, class Handler {})],
  ["no prototype", () => { const list = four(); Object.setPrototypeOf(list[8], null); return list; }],
  ["takes another place", () => { const list = four(); list[15] = list[0]; return list; }],
];
const numbers: [string, () => number[]][] = [
  ["whole", () => Array.from({ length: 40 }, (_, k) => (k * 7919) % 101 - 20)],
  ["fractions", () => Array.from({ length: 40 }, (_, k) => k / 4)],
  ["large", () => Array.from({ length: 40 }, (_, k) => (k % 3) * 2147483647)],
  ["a string", () => { const list: number[] = Array.from({ length: 40 }, (_, k) => k); (list as unknown[])[17] = "q"; return list; }],
  ["undefined", () => { const list: number[] = Array.from({ length: 40 }, (_, k) => k); (list as unknown[])[21] = undefined; return list; }],
  ["an object", () => { const list: number[] = Array.from({ length: 40 }, (_, k) => k); (list as unknown[])[22] = { valueOf() { shared++; return 5; } }; return list; }],
];
const loops: [string, (list: number[], handlers: Handler[]) => number][] = [
  ["bits", (list, handlers) => { let total = 0; for (let k = 0; k < list.length; k++) total = (total + handlers[k & 15](list[k])) & 0xffffff; return total; }],
  ["sum", (list, handlers) => { let total = 0; for (let k = 0; k < list.length; k++) { shared++; total += handlers[k & 15](list[k]); } return total; }],
  ["of", (list, handlers) => { let total = 0; for (const n of list) total = (total * 3 + handlers[n & 15](n)) % 1000; return total; }],
  ["twice", (list, handlers) => { let total = 0; for (let k = 0; k < list.length; k++) { const h = handlers[(k * 5) & 15]; total = (total + h(list[k]) + h(k)) | 0; if (k === 30) Object.assign(h, { late: k }); } return total; }],
  ["changes", (list, handlers) => { let total = 0; for (let k = 0; k < list.length; k++) { total = (total + handlers[k & 15](list[k])) & 0xffff; if (k === 20) handlers[(k + 2) & 15] = n => n * 100; if (k === 33) (handlers as unknown[]).length = 9; } return total; }],
];
for (const [form, loop] of loops) {
  for (const [kind, make] of lists) {
    for (const [holds, values] of numbers) {
      const handlers = make();
      let line = form + " | " + kind + " | " + holds + " | ";
      for (let round = 0; round < 2; round++) {
        try { line += show(loop(values(), handlers)) + " "; } catch (error) { line += "threw " + show(error) + " "; }
      }
      out.push(line + shared);
    }
  }
}
let hash = 7;
for (const line of out) for (let k = 0; k < line.length; k++) hash = (Math.imul(hash, 31) + line.charCodeAt(k)) | 0;
console.log(out.length, hash);
console.log(out.filter((_, k) => k % 3 === 0).join("\n"));
