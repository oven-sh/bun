// Values that equal a literal, from every source of a text: the cell of the literal, another cell of its atom, a rope, a piece of a longer text, a text of the same characters in 8 and 16 bits.
declare const process: { argv: string[]; env: Record<string, string> }; declare const Buffer: any; declare const structuredClone: any; declare const TextDecoder: any; declare const TextEncoder: any;
const KINDS = ["add", "remove", "insert", "constructor", "a-text-of-more-than-eight-units", "x", "", "length", "\u4e2d\u6587", "caf\u00e9", "\u00e9", "\ud83d\ude00", "7", "12"];

const join = (a: string, b: string): string => a + b;
const half = (t: string): [string, string] => [t.slice(0, t.length >> 1), t.slice(t.length >> 1)];
const sources: [string, (t: string) => unknown][] = [
  ['literal', t => t],
  ['json', t => JSON.parse(JSON.stringify(t))],
  ['json-field', t => JSON.parse(JSON.stringify({ type: t })).type],
  ['json-key', t => Object.keys(JSON.parse(JSON.stringify({ [t]: 1 })))[0]],
  ['slice', t => ('<' + t + '>').slice(1, -1)],
  ['substring-of-wide', t => ('中' + t + '中').slice(1, -1)],
  ['concat', t => join(...half(t))],
  ['three', t => { const [a, b] = half(t); const [c, d] = half(b); return a + c + d; }],
  ['template', t => { const [a, b] = half(t); return `${a}${b}`; }],
  ['key', t => Object.keys({ [t]: 1 })[0]],
  ['for-in', t => { for (const k in { [t]: 1 }) return k; return 'nothing'; }],
  ['entries', t => Object.entries({ [t]: 1 })[0]![0]],
  ['symbol', t => Symbol(t).description],
  ['symbol-for', t => Symbol.keyFor(Symbol.for(t))],
  ['symbol-text', t => String(Symbol(t)).slice(7, -1)],
  ['split', t => ('q|' + t + '|r').split('|')[1]],
  ['characters', t => Array.from(t).join('')],
  ['codes', t => String.fromCharCode(...Array.from({ length: t.length }, (_, i) => t.charCodeAt(i)))],
  ['points', t => String.fromCodePoint(...Array.from(t, c => c.codePointAt(0)!))],
  ['replace', t => ('#' + t).replace('#', '')],
  ['match', t => /^\[(.*)\]$/s.exec('[' + t + ']')![1]],
  ['case', t => t.toUpperCase().toLowerCase() === t ? t.toUpperCase().toLowerCase() : join(t, '')],
  ['normalize', t => t.normalize()],
  ['trim', t => (' \t' + t + '\n').trim() === t ? (' \t' + t + '\n').trim() : t],
  ['repeat', t => t.repeat(2).slice(0, t.length)],
  ['pad', t => (t + 'zz').substring(0, t.length)],
  ['clone', t => structuredClone({ t }).t],
  ['clone-map', t => [...structuredClone(new Map([[t, 1]])).keys()][0]],
  ['bytes', t => new TextDecoder().decode(new TextEncoder().encode(t))],
  ['buffer', t => Buffer.from(t, 'utf16le').toString('utf16le')],
  ['uri', t => decodeURIComponent(encodeURIComponent(t))],
  ['error', t => new Error(t).message],
  ['function-name', t => Object.defineProperty(() => 0, 'name', { value: t }).name],
  ['computed-name', t => ({ [t]: () => 0 })[t]!.name],
  ['map-key', t => [...new Map([[join(t, ''), 1]]).keys()][0]],
  ['set', t => [...new Set([t])][0]],
  ['sorted', t => [t, t].sort()[1]],
  ['boxed', t => new String(t).valueOf()],
  ['object', t => new String(t)],
  ['raw', t => String.raw({ raw: [t] })],
  ['at', t => Array.from({ length: t.length }, (_, i) => t.at(i)).join('')],
  ['indirect', t => (0, eval)(JSON.stringify(t))],
  ['proxy', t => new Proxy({ t }, {}).t],
  ['getter', t => ({ get t() { return join(t, ''); } }).t],
  ['number', t => t.length],
  ['nothing', t => undefined], ['null', t => null], ['true', t => true], ['symbol-itself', t => Symbol(t)], ['big', t => BigInt(t.length)], ['list', t => [t]], ['plain', t => ({ t })], ['double', t => t.length + 0.5],
];
const TABLE: Record<string, number> = { __proto__: null as never, "add": 1, "remove": 2, "insert": 4, "constructor": 8, "a-text-of-more-than-eight-units": 16, "x": 32, "": 64, "length": 128, "\u4e2d\u6587": 256, "caf\u00e9": 512, "\u00e9": 1024, "\ud83d\ude00": 2048, "7": 4096, "12": 8192 };
type V = unknown;
function inLoop(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (v === "add") r += 1; if (v === "remove") r += 2; if (v === "insert") r += 4; if (v === "constructor") r += 8; if (v === "a-text-of-more-than-eight-units") r += 16; if (v === "x") r += 32; if (v === "") r += 64; if (v === "length") r += 128; if (v === "\u4e2d\u6587") r += 256; if (v === "caf\u00e9") r += 512; if (v === "\u00e9") r += 1024; if (v === "\ud83d\ude00") r += 2048; if (v === "7") r += 4096; if (v === "12") r += 8192; out.push(r); }
  return out;
}
function one(v: V): number { let r = 0; if (v === "add") r += 1; if (v === "remove") r += 2; if (v === "insert") r += 4; if (v === "constructor") r += 8; if (v === "a-text-of-more-than-eight-units") r += 16; if (v === "x") r += 32; if (v === "") r += 64; if (v === "length") r += 128; if (v === "\u4e2d\u6587") r += 256; if (v === "caf\u00e9") r += 512; if (v === "\u00e9") r += 1024; if (v === "\ud83d\ude00") r += 2048; if (v === "7") r += 4096; if (v === "12") r += 8192; return r; }
class Holder { constructor(public v: V) {} }
function inFields(list: Holder[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) { const v = list[i]!.v; let r = 0; if (v === "add") r += 1; if (v === "remove") r += 2; if (v === "insert") r += 4; if (v === "constructor") r += 8; if (v === "a-text-of-more-than-eight-units") r += 16; if (v === "x") r += 32; if (v === "") r += 64; if (v === "length") r += 128; if (v === "\u4e2d\u6587") r += 256; if (v === "caf\u00e9") r += 512; if (v === "\u00e9") r += 1024; if (v === "\ud83d\ude00") r += 2048; if (v === "7") r += 4096; if (v === "12") r += 8192; sum = (sum * 31 + r) % 1000003; }
  return sum;
}
function askReversed(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if ("add" === v) r += 1; if ("remove" === v) r += 2; if ("insert" === v) r += 4; if ("constructor" === v) r += 8; if ("a-text-of-more-than-eight-units" === v) r += 16; if ("x" === v) r += 32; if ("" === v) r += 64; if ("length" === v) r += 128; if ("\u4e2d\u6587" === v) r += 256; if ("caf\u00e9" === v) r += 512; if ("\u00e9" === v) r += 1024; if ("\ud83d\ude00" === v) r += 2048; if ("7" === v) r += 4096; if ("12" === v) r += 8192; out.push(r); }
  return out;
}
function askNot(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (v !== "add") r += 1; if (v !== "remove") r += 2; if (v !== "insert") r += 4; if (v !== "constructor") r += 8; if (v !== "a-text-of-more-than-eight-units") r += 16; if (v !== "x") r += 32; if (v !== "") r += 64; if (v !== "length") r += 128; if (v !== "\u4e2d\u6587") r += 256; if (v !== "caf\u00e9") r += 512; if (v !== "\u00e9") r += 1024; if (v !== "\ud83d\ude00") r += 2048; if (v !== "7") r += 4096; if (v !== "12") r += 8192; out.push(r); }
  return out;
}
function askElse(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (v === "add") r += 1; else if (v === "remove") r += 2; else if (v === "insert") r += 4; else if (v === "constructor") r += 8; else if (v === "a-text-of-more-than-eight-units") r += 16; else if (v === "x") r += 32; else if (v === "") r += 64; else if (v === "length") r += 128; else if (v === "\u4e2d\u6587") r += 256; else if (v === "caf\u00e9") r += 512; else if (v === "\u00e9") r += 1024; else if (v === "\ud83d\ude00") r += 2048; else if (v === "7") r += 4096; else if (v === "12") r += 8192; out.push(r); }
  return out;
}
function askSwitch(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; switch (v) { case "add": r += 1; break; case "remove": r += 2; break; case "insert": r += 4; break; case "constructor": r += 8; break; case "a-text-of-more-than-eight-units": r += 16; break; case "x": r += 32; break; case "": r += 64; break; case "length": r += 128; break; case "\u4e2d\u6587": r += 256; break; case "caf\u00e9": r += 512; break; case "\u00e9": r += 1024; break; case "\ud83d\ude00": r += 2048; break; case "7": r += 4096; break; case "12": r += 8192; break; default: r += 3; } out.push(r); }
  return out;
}
function askTernary(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; r += v === "add" ? 1 : v === "remove" ? 2 : v === "insert" ? 4 : v === "constructor" ? 8 : v === "a-text-of-more-than-eight-units" ? 16 : v === "x" ? 32 : v === "" ? 64 : v === "length" ? 128 : v === "\u4e2d\u6587" ? 256 : v === "caf\u00e9" ? 512 : v === "\u00e9" ? 1024 : v === "\ud83d\ude00" ? 2048 : v === "7" ? 4096 : v === "12" ? 8192 :  7; out.push(r); }
  return out;
}
function askOr(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (v === "add" || v === "insert" || v === "a-text-of-more-than-eight-units" || v === "" || v === "\u4e2d\u6587" || v === "\u00e9" || v === "7") r += 1; if (v === "remove" || v === "constructor" || v === "x" || v === "length" || v === "caf\u00e9" || v === "\ud83d\ude00" || v === "12") r += 2; out.push(r); }
  return out;
}
function askAnd(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (v !== "add" && v !== "insert" && v !== "a-text-of-more-than-eight-units" && v !== "" && v !== "\u4e2d\u6587" && v !== "\u00e9" && v !== "7") r += 1; if (v !== "remove" && v !== "constructor" && v !== "x" && v !== "length" && v !== "caf\u00e9" && v !== "\ud83d\ude00" && v !== "12") r += 2; out.push(r); }
  return out;
}
function askKept(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; const b0 = v === "add"; const b1 = v === "remove"; const b2 = v === "insert"; const b3 = v === "constructor"; const b4 = v === "a-text-of-more-than-eight-units"; const b5 = v === "x"; const b6 = v === ""; const b7 = v === "length"; const b8 = v === "\u4e2d\u6587"; const b9 = v === "caf\u00e9"; const b10 = v === "\u00e9"; const b11 = v === "\ud83d\ude00"; const b12 = v === "7"; const b13 = v === "12"; r += (b0 ? 1 : 0) + (b1 ? 2 : 0) + (b2 ? 4 : 0) + (b3 ? 8 : 0) + (b4 ? 16 : 0) + (b5 ? 32 : 0) + (b6 ? 64 : 0) + (b7 ? 128 : 0) + (b8 ? 256 : 0) + (b9 ? 512 : 0) + (b10 ? 1024 : 0) + (b11 ? 2048 : 0) + (b12 ? 4096 : 0) + (b13 ? 8192 : 0); out.push(r); }
  return out;
}
function askTypeof(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (typeof v === 'string') { if (v === "add") r += 1; if (v === "remove") r += 2; if (v === "insert") r += 4; if (v === "constructor") r += 8; if (v === "a-text-of-more-than-eight-units") r += 16; if (v === "x") r += 32; if (v === "") r += 64; if (v === "length") r += 128; if (v === "\u4e2d\u6587") r += 256; if (v === "caf\u00e9") r += 512; if (v === "\u00e9") r += 1024; if (v === "\ud83d\ude00") r += 2048; if (v === "7") r += 4096; if (v === "12") r += 8192; } out.push(r); }
  return out;
}
function askLoose(list: V[]): number[] {
  const out: number[] = [];
  for (const v of list) { let r = 0; if (typeof v === 'string') { if (v == "add") r += 1; if (v == "remove") r += 2; if (v == "insert") r += 4; if (v == "constructor") r += 8; if (v == "a-text-of-more-than-eight-units") r += 16; if (v == "x") r += 32; if (v == "") r += 64; if (v == "length") r += 128; if (v == "\u4e2d\u6587") r += 256; if (v == "caf\u00e9") r += 512; if (v == "\u00e9") r += 1024; if (v == "\ud83d\ude00") r += 2048; if (v == "7") r += 4096; if (v == "12") r += 8192; } out.push(r); }
  return out;
}
const values: V[] = [], names: string[] = [];
for (const [name, make] of sources) for (const t of KINDS) { let v: unknown; try { v = make(t); } catch (e) { v = 'threw ' + (e as Error).name; } values.push(v as V); names.push(name + ' ' + JSON.stringify(t)); }
for (const t of ['', 'q', 'adds', 'ad', 'Add', 'nothing here', '\u4e2e']) { values.push(t as V); names.push('other ' + t); }
let h = 0;
const first = inLoop(values), single = values.map(one), fields = inFields(values.map(v => new Holder(v)));
for (let round = 0; round < 3; round++) { const a = inLoop(values); for (let i = 0; i < a.length; i++) { h = (h * 31 + a[i]!) % 1000003; if (a[i] !== first[i] || (a[i] !== single[i])) console.log('DIFFERS', names[i], a[i], first[i], single[i]); } }
console.log(h, fields, single.length);
for (const [form, answers] of [['reversed', askReversed(values)], ['not', askNot(values)], ['else', askElse(values)], ['switch', askSwitch(values)], ['ternary', askTernary(values)], ['or', askOr(values)], ['and', askAnd(values)], ['kept', askKept(values)], ['typeof', askTypeof(values)], ['loose', askLoose(values)]] as const) { let sum = 0; for (const a of answers) sum = (sum * 31 + a) % 1000003; console.log(form, sum); }
for (let i = 0; i < first.length; i++) console.log(names[i], first[i]);
export {};
