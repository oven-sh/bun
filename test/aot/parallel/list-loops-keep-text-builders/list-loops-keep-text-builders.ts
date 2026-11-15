declare const process: any;
const log: string[] = [];
function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i in v ? show(v[i]) : "hole") + ","; return s + "]"; }
  if (typeof v === "object" && v !== null) return "object";
  if (typeof v === "symbol") return "symbol";
  return String(v);
}
function attempt(name: string, f: () => any) { try { log.push(name + " " + show(f())); } catch (e: any) { log.push(name + " threw " + (e && e.constructor && e.constructor.name) + " " + String(e && e.message).slice(0, 60)); } }
interface E { skip: boolean; text: string; at: number; extra?: any }
class Item { constructor(readonly skip: boolean, readonly text: string, readonly at: number, readonly extra?: any) {} }
let calls = 0, seen: any = "", current: any[] = [];
const odd: any[] = [1, -0, 0.1, NaN, Infinity, 1e21, 9007199254740993, null, undefined, true, 5n, "\u{1F600}", "\uD83D", "\uDE00", "", { toString() { return "T" + calls; } }, { valueOf() { calls++; return 7; } }, { [Symbol.toPrimitive]() { return seen === "" ? "e" : "s"; } }, [8, [9]], new Date(0).getTime(), Symbol.iterator, Object.create(null), () => 1, "x".repeat(300), "ab".concat("cd"), "long text to cut".slice(2, 9)];
const handlers: any = {
  plain(e: E) { calls++; return e.text; },
  odd(e: E) { calls++; return odd[e.at % odd.length]; },
  numbers(e: E) { calls++; return e.at % 3 ? e.at / 4 : e.at; },
  throwing(e: E) { calls++; if (e.at === 7) throw new RangeError("at " + e.at); return "[" + e.at + "]"; },
  growing(e: E) { calls++; if (current.length < 30) current.push({ skip: false, text: "g" + current.length, at: current.length }); return e.text; },
  shrinking(e: E) { calls++; if (current.length > 6) current.length = current.length - 1; return e.text; },
  holes(e: E) { calls++; if (e.at === 3 && 5 in current) delete current[5]; return e.text; },
  changing(e: E) { calls++; (e as any).text = e.text + "!"; (e as any).skip = !e.skip; return e.text; },
  getter(e: E) { calls++; if (e.at === 2) Object.defineProperty(e, "text", { get() { calls++; return "got" + calls; }, configurable: true }); return e.text; },
  nested(e: E): string { calls++; let s = ""; for (const c of e.text) s += c + calls; return s; },
  long(e: E) { calls++; return e.text.repeat(40); },
};
function made(n: number, every: number, kind: number): any {
  const list: any[] = [];
  for (let i = 0; i < n; i++) list.push(kind & 1 ? new Item(i % every !== 0, "t" + i, i, odd[i % odd.length]) : { skip: i % every !== 0, text: "t" + i, at: i, extra: odd[i % odd.length] });
  if (kind === 2) return new Set(list);
  if (kind === 3) return new Map(list.map(e => [e.text, e])).values();
  if (kind === 4) return (function* () { for (const e of list) yield e; })();
  if (kind === 5) { delete list[4]; return list; }
  if (kind === 6) { class Sub extends Array<any> {} return Sub.from(list); }
  if (kind === 7) { (list as any)[Symbol.iterator] = function* () { yield list[0]; yield list[1]; }; return list; }
  return list;
}
const names = Object.keys(handlers);
let sinks: string[] = [];
function keep(s: string) { sinks.push(s); return s.length; }
function every(name: string, run: (list: any, f: any) => any) {
  for (const h of names) for (const [n, k] of [[0, 1], [1, 1], [9, 1], [12, 2], [25, 10], [40, 100]]) for (let kind = 0; kind < 8; kind++) {
    calls = 0; seen = ""; sinks = []; current = made(n!, k!, kind); attempt(name + " " + h + n + "/" + k + "#" + kind, () => [run(current, handlers[h]), calls, seen, sinks.length, sinks.join("|")]);
  }
}

function t0(list: Item[], f: any): string { let out: string = odd[calls] as string, other = "", n = 0; let k = 0; for (const e of list) { if (e.skip) { other += "o"; continue; } if (k++ % 3) out += e.text + f(e); else other += f(e); other = out; } return out.length ? out.slice(0, 50) + out.length + n : other; }
every("t0", t0);
function t1(list: E[], f: (e: E) => string): string { let out: string = "", other = "", n = 0; for (const e of list) { if (!e.skip) { out += f(e) + out.length; if (out.length > 60) { keep(out); out = ""; } } } return out.length ? out.slice(0, 50) + out.length + n : other; }
every("t1", t1);
function t2(list: Item[], f: (e: E) => string): string { let out: string = "", other = "", n = 0; for (const e of list) { if (e.skip) { other += "o"; continue; } out += f(e) + e.text; other += f(e); out = out.trim(); } return out + "/" + other + "/" + n; }
every("t2", t2);
function t3(list: Iterable<E>, f: any): string { let out: string = "", other = "", n = 0; for (const e of list) { if (e.text.length > 2 && e.skip) { n += e.at; continue; } try { out += f(e); } catch (x: any) { out += "c" + x.message; } other = out; } keep(out); return n + out; }
every("t3", t3);
function t4(list: any, f: any): string { let out: string = seen, other = "", n = 0; for (const e of list) {  try { out += f(e) + f(e); } catch (x: any) { out += "c" + x.message; } out += e.text; } return out + "/" + other + "/" + n; }
every("t4", t4);
function t5(list: E[], f: (e: E) => any): string { let out: string = "", other = "", n = 0; for (const [i, e] of (Array.isArray(list) ? list : [...list]).entries()) { if (!e.text) continue; out += i + out.length + f(e); n += out.charCodeAt(0) | 0; } return out; }
every("t5", t5);
function t6(list: E[], f: (e: E) => any): string { let out: string = "start", other = "", n = 0; for (const e of list) {  try { out += String(f(e)); } catch (x: any) { out += "c" + x.message; }  } return out + "/" + other + "/" + n; }
every("t6", t6);
function t7(list: E[], f: (e: E) => string): string { let out: string = odd[calls] as string, other = "", n = 0; for (const e of list) { if (!e.skip) { out += String(f(e)); if (out.endsWith("3")) out += "!"; } } return out + "/" + other + "/" + n; }
every("t7", t7);
let digest = 0; for (const l of log) for (let i = 0; i < l.length; i++) digest = (digest * 31 + l.charCodeAt(i)) | 0;
console.log(log.length, digest);
console.log(process.argv[2] === "all" ? log.join("\n") : log.filter((_, i) => i % 61 === 0).join("\n"));
