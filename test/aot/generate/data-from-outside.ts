// The programs of data-from-outside that are one text but for a few places.
import { family, programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "json-parse-type-argument-types-parsed-once-at-module-level.ts": text(
      `// Types are parsed once each, at module level, with collections in between. What one declares is an undeclared key for all the others.
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
let serial = 0;
function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}
function freshValue(at: number): string {
  switch (at % 4) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + "]}";
    case 2:
      return "[" + longText() + "," + ++serial + "]";
    default:
      return longText();
  }
}

type T0 = { kaan: number; kaas: string };
type T1 = { kban: number; kbas: string };
type T2 = { kcan: number; kcas: string };
type T3 = { kdan: number; kdas: string };
type T4 = { kean: number; keas: string };
type T5 = { kfan: number; kfas: string };
type T6 = { kgan: number; kgas: string };
type T7 = { khan: number; khas: string };
type T8 = { kian: number; kias: string };
type T9 = { kjan: number; kjas: string };
type T10 = { kkan: number; kkas: string };
type T11 = { klan: number; klas: string };
type T12 = { kman: number; kmas: string };
type T13 = { knan: number; knas: string };
type T14 = { koan: number; koas: string };
type T15 = { kpan: number; kpas: string };
type T16 = { kqan: number; kqas: string };
type T17 = { kran: number; kras: string };
type T18 = { ksan: number; ksas: string };
type T19 = { ktan: number; ktas: string };
type T20 = { kuan: number; kuas: string };
type T21 = { kvan: number; kvas: string };
type T22 = { kwan: number; kwas: string };
type T23 = { kxan: number; kxas: string };
type T24 = { kyan: number; kyas: string };
type T25 = { kzan: number; kzas: string };
type T26 = { kabn: number; kabs: string };
type T27 = { kbbn: number; kbbs: string };
type T28 = { kcbn: number; kcbs: string };
type T29 = { kdbn: number; kdbs: string };
type T30 = { kebn: number; kebs: string };
type T31 = { kfbn: number; kfbs: string };
type T32 = { kgbn: number; kgbs: string };
type T33 = { khbn: number; khbs: string };
type T34 = { kibn: number; kibs: string };
type T35 = { kjbn: number; kjbs: string };
type T36 = { kkbn: number; kkbs: string };
type T37 = { klbn: number; klbs: string };
type T38 = { kmbn: number; kmbs: string };
type T39 = { knbn: number; knbs: string };
const members: string[] = [];
for (let at = 0; at < 40; at++) { const stem = "k" + String.fromCharCode(97 + (at % 26)) + String.fromCharCode(97 + Math.floor(at / 26)); members.push('"' + stem + 'n":' + at, '"' + stem + 's":' + longText()); }
const text = "{" + members.join(",") + "}";
let different = 0;`,
      [
        `0_0 = JSON.parse(text) as T0	0_0.kaan !== 0 || v0_0.kaas.length < 40 || JSON.stringify(v0_0	0_1 = JSON.parse(text) as T1	0_1.kban !== 1 || v0_1.kbas.length < 40 || JSON.stringify(v0_1	0_2 = JSON.parse(text) as T2	0_2.kcan !== 2 || v0_2.kcas.length < 40 || JSON.stringify(v0_2	0_3 = JSON.parse(text) as T3	0_3.kdan !== 3 || v0_3.kdas.length < 40 || JSON.stringify(v0_3	0_4 = JSON.parse(text) as T4	0_4.kean !== 4 || v0_4.keas.length < 40 || JSON.stringify(v0_4
0_5 = JSON.parse(text) as T5	0_5.kfan !== 5 || v0_5.kfas.length < 40 || JSON.stringify(v0_5	0_6 = JSON.parse(text) as T6	0_6.kgan !== 6 || v0_6.kgas.length < 40 || JSON.stringify(v0_6	0_7 = JSON.parse(text) as T7	0_7.khan !== 7 || v0_7.khas.length < 40 || JSON.stringify(v0_7	0_8 = JSON.parse(text) as T8	0_8.kian !== 8 || v0_8.kias.length < 40 || JSON.stringify(v0_8	0_9 = JSON.parse(text) as T9	0_9.kjan !== 9 || v0_9.kjas.length < 40 || JSON.stringify(v0_9
0_10 = JSON.parse(text) as T10	0_10.kkan !== 10 || v0_10.kkas.length < 40 || JSON.stringify(v0_10	0_11 = JSON.parse(text) as T11	0_11.klan !== 11 || v0_11.klas.length < 40 || JSON.stringify(v0_11	0_12 = JSON.parse(text) as T12	0_12.kman !== 12 || v0_12.kmas.length < 40 || JSON.stringify(v0_12	0_13 = JSON.parse(text) as T13	0_13.knan !== 13 || v0_13.knas.length < 40 || JSON.stringify(v0_13	0_14 = JSON.parse(text) as T14	0_14.koan !== 14 || v0_14.koas.length < 40 || JSON.stringify(v0_14
0_15 = JSON.parse(text) as T15	0_15.kpan !== 15 || v0_15.kpas.length < 40 || JSON.stringify(v0_15	0_16 = JSON.parse(text) as T16	0_16.kqan !== 16 || v0_16.kqas.length < 40 || JSON.stringify(v0_16	0_17 = JSON.parse(text) as T17	0_17.kran !== 17 || v0_17.kras.length < 40 || JSON.stringify(v0_17	0_18 = JSON.parse(text) as T18	0_18.ksan !== 18 || v0_18.ksas.length < 40 || JSON.stringify(v0_18	0_19 = JSON.parse(text) as T19	0_19.ktan !== 19 || v0_19.ktas.length < 40 || JSON.stringify(v0_19
0_20 = JSON.parse(text) as T20	0_20.kuan !== 20 || v0_20.kuas.length < 40 || JSON.stringify(v0_20	0_21 = JSON.parse(text) as T21	0_21.kvan !== 21 || v0_21.kvas.length < 40 || JSON.stringify(v0_21	0_22 = JSON.parse(text) as T22	0_22.kwan !== 22 || v0_22.kwas.length < 40 || JSON.stringify(v0_22	0_23 = JSON.parse(text) as T23	0_23.kxan !== 23 || v0_23.kxas.length < 40 || JSON.stringify(v0_23	0_24 = JSON.parse(text) as T24	0_24.kyan !== 24 || v0_24.kyas.length < 40 || JSON.stringify(v0_24
0_25 = JSON.parse(text) as T25	0_25.kzan !== 25 || v0_25.kzas.length < 40 || JSON.stringify(v0_25	0_26 = JSON.parse(text) as T26	0_26.kabn !== 26 || v0_26.kabs.length < 40 || JSON.stringify(v0_26	0_27 = JSON.parse(text) as T27	0_27.kbbn !== 27 || v0_27.kbbs.length < 40 || JSON.stringify(v0_27	0_28 = JSON.parse(text) as T28	0_28.kcbn !== 28 || v0_28.kcbs.length < 40 || JSON.stringify(v0_28	0_29 = JSON.parse(text) as T29	0_29.kdbn !== 29 || v0_29.kdbs.length < 40 || JSON.stringify(v0_29
0_30 = JSON.parse(text) as T30	0_30.kebn !== 30 || v0_30.kebs.length < 40 || JSON.stringify(v0_30	0_31 = JSON.parse(text) as T31	0_31.kfbn !== 31 || v0_31.kfbs.length < 40 || JSON.stringify(v0_31	0_32 = JSON.parse(text) as T32	0_32.kgbn !== 32 || v0_32.kgbs.length < 40 || JSON.stringify(v0_32	0_33 = JSON.parse(text) as T33	0_33.khbn !== 33 || v0_33.khbs.length < 40 || JSON.stringify(v0_33	0_34 = JSON.parse(text) as T34	0_34.kibn !== 34 || v0_34.kibs.length < 40 || JSON.stringify(v0_34
0_35 = JSON.parse(text) as T35	0_35.kjbn !== 35 || v0_35.kjbs.length < 40 || JSON.stringify(v0_35	0_36 = JSON.parse(text) as T36	0_36.kkbn !== 36 || v0_36.kkbs.length < 40 || JSON.stringify(v0_36	0_37 = JSON.parse(text) as T37	0_37.klbn !== 37 || v0_37.klbs.length < 40 || JSON.stringify(v0_37	0_38 = JSON.parse(text) as T38	0_38.kmbn !== 38 || v0_38.kmbs.length < 40 || JSON.stringify(v0_38	0_39 = JSON.parse(text) as T39	0_39.knbn !== 39 || v0_39.knbs.length < 40 || JSON.stringify(v0_39
1_0 = JSON.parse(text) as T0	1_0.kaan !== 0 || v1_0.kaas.length < 40 || JSON.stringify(v1_0	1_1 = JSON.parse(text) as T1	1_1.kban !== 1 || v1_1.kbas.length < 40 || JSON.stringify(v1_1	1_2 = JSON.parse(text) as T2	1_2.kcan !== 2 || v1_2.kcas.length < 40 || JSON.stringify(v1_2	1_3 = JSON.parse(text) as T3	1_3.kdan !== 3 || v1_3.kdas.length < 40 || JSON.stringify(v1_3	1_4 = JSON.parse(text) as T4	1_4.kean !== 4 || v1_4.keas.length < 40 || JSON.stringify(v1_4
1_5 = JSON.parse(text) as T5	1_5.kfan !== 5 || v1_5.kfas.length < 40 || JSON.stringify(v1_5	1_6 = JSON.parse(text) as T6	1_6.kgan !== 6 || v1_6.kgas.length < 40 || JSON.stringify(v1_6	1_7 = JSON.parse(text) as T7	1_7.khan !== 7 || v1_7.khas.length < 40 || JSON.stringify(v1_7	1_8 = JSON.parse(text) as T8	1_8.kian !== 8 || v1_8.kias.length < 40 || JSON.stringify(v1_8	1_9 = JSON.parse(text) as T9	1_9.kjan !== 9 || v1_9.kjas.length < 40 || JSON.stringify(v1_9
1_10 = JSON.parse(text) as T10	1_10.kkan !== 10 || v1_10.kkas.length < 40 || JSON.stringify(v1_10	1_11 = JSON.parse(text) as T11	1_11.klan !== 11 || v1_11.klas.length < 40 || JSON.stringify(v1_11	1_12 = JSON.parse(text) as T12	1_12.kman !== 12 || v1_12.kmas.length < 40 || JSON.stringify(v1_12	1_13 = JSON.parse(text) as T13	1_13.knan !== 13 || v1_13.knas.length < 40 || JSON.stringify(v1_13	1_14 = JSON.parse(text) as T14	1_14.koan !== 14 || v1_14.koas.length < 40 || JSON.stringify(v1_14
1_15 = JSON.parse(text) as T15	1_15.kpan !== 15 || v1_15.kpas.length < 40 || JSON.stringify(v1_15	1_16 = JSON.parse(text) as T16	1_16.kqan !== 16 || v1_16.kqas.length < 40 || JSON.stringify(v1_16	1_17 = JSON.parse(text) as T17	1_17.kran !== 17 || v1_17.kras.length < 40 || JSON.stringify(v1_17	1_18 = JSON.parse(text) as T18	1_18.ksan !== 18 || v1_18.ksas.length < 40 || JSON.stringify(v1_18	1_19 = JSON.parse(text) as T19	1_19.ktan !== 19 || v1_19.ktas.length < 40 || JSON.stringify(v1_19
1_20 = JSON.parse(text) as T20	1_20.kuan !== 20 || v1_20.kuas.length < 40 || JSON.stringify(v1_20	1_21 = JSON.parse(text) as T21	1_21.kvan !== 21 || v1_21.kvas.length < 40 || JSON.stringify(v1_21	1_22 = JSON.parse(text) as T22	1_22.kwan !== 22 || v1_22.kwas.length < 40 || JSON.stringify(v1_22	1_23 = JSON.parse(text) as T23	1_23.kxan !== 23 || v1_23.kxas.length < 40 || JSON.stringify(v1_23	1_24 = JSON.parse(text) as T24	1_24.kyan !== 24 || v1_24.kyas.length < 40 || JSON.stringify(v1_24
1_25 = JSON.parse(text) as T25	1_25.kzan !== 25 || v1_25.kzas.length < 40 || JSON.stringify(v1_25	1_26 = JSON.parse(text) as T26	1_26.kabn !== 26 || v1_26.kabs.length < 40 || JSON.stringify(v1_26	1_27 = JSON.parse(text) as T27	1_27.kbbn !== 27 || v1_27.kbbs.length < 40 || JSON.stringify(v1_27	1_28 = JSON.parse(text) as T28	1_28.kcbn !== 28 || v1_28.kcbs.length < 40 || JSON.stringify(v1_28	1_29 = JSON.parse(text) as T29	1_29.kdbn !== 29 || v1_29.kdbs.length < 40 || JSON.stringify(v1_29
1_30 = JSON.parse(text) as T30	1_30.kebn !== 30 || v1_30.kebs.length < 40 || JSON.stringify(v1_30	1_31 = JSON.parse(text) as T31	1_31.kfbn !== 31 || v1_31.kfbs.length < 40 || JSON.stringify(v1_31	1_32 = JSON.parse(text) as T32	1_32.kgbn !== 32 || v1_32.kgbs.length < 40 || JSON.stringify(v1_32	1_33 = JSON.parse(text) as T33	1_33.khbn !== 33 || v1_33.khbs.length < 40 || JSON.stringify(v1_33	1_34 = JSON.parse(text) as T34	1_34.kibn !== 34 || v1_34.kibs.length < 40 || JSON.stringify(v1_34
1_35 = JSON.parse(text) as T35	1_35.kjbn !== 35 || v1_35.kjbs.length < 40 || JSON.stringify(v1_35	1_36 = JSON.parse(text) as T36	1_36.kkbn !== 36 || v1_36.kkbs.length < 40 || JSON.stringify(v1_36	1_37 = JSON.parse(text) as T37	1_37.klbn !== 37 || v1_37.klbs.length < 40 || JSON.stringify(v1_37	1_38 = JSON.parse(text) as T38	1_38.kmbn !== 38 || v1_38.kmbs.length < 40 || JSON.stringify(v1_38	1_39 = JSON.parse(text) as T39	1_39.knbn !== 39 || v1_39.knbs.length < 40 || JSON.stringify(v1_39`,
        (n, a, b, c, d, e, f, g, h, i, j) => `collect();
const v${a};
if (v${b}) !== text) different++;
collect();
const v${c};
if (v${d}) !== text) different++;
collect();
const v${e};
if (v${f}) !== text) different++;
collect();
const v${g};
if (v${h}) !== text) different++;
collect();
const v${i};
if (v${j}) !== text) different++;`,
      ],
      `collect();
for (const value of [v0_0, v1_0, v0_1, v1_1, v0_2, v1_2, v0_3, v1_3, v0_4, v1_4, v0_5, v1_5, v0_6, v1_6, v0_7, v1_7, v0_8, v1_8, v0_9, v1_9, v0_10, v1_10, v0_11, v1_11, v0_12, v1_12, v0_13, v1_13, v0_14, v1_14, v0_15, v1_15, v0_16, v1_16, v0_17, v1_17, v0_18, v1_18, v0_19, v1_19, v0_20, v1_20, v0_21, v1_21, v0_22, v1_22, v0_23, v1_23, v0_24, v1_24, v0_25, v1_25, v0_26, v1_26, v0_27, v1_27, v0_28, v1_28, v0_29, v1_29, v0_30, v1_30, v0_31, v1_31, v0_32, v1_32, v0_33, v1_33, v0_34, v1_34, v0_35, v1_35, v0_36, v1_36, v0_37, v1_37, v0_38, v1_38, v0_39, v1_39]) if (JSON.stringify(value) !== text) different++;
console.log("40 types, twice: " + different + " differ");
`,
    ),
    ...family(
      `untyped-built-object-as-prototype.ts	it is the prototype of another object", () => { const o = JSON.parse(text); kept.push(Object.create(o)
untyped-built-object-assign-onto-alias.ts	Object.assign onto an object that is held", () => { const o: any = keep({}); Object.assign(o, JSON.parse(text)
untyped-built-object-computed-key-stores.ts	stores under computed names", () => { const o: any = {}; const from = JSON.parse(text); for (const k in from) o[k] = from[k]; keep(o
untyped-built-object-from-entries.ts	Object.fromEntries", () => { const o = keep(Object.fromEntries(Object.entries(JSON.parse(text)))
untyped-built-object-named-stores.ts	stores under written names", () => { const o: any = {}; o.id = 1; o.at = 0.5; o.low = 1.5; o.high = 2.5; o.mean = 3.5; o.count = 4; o.unit = "C"; o.place = { name: "roof" }; keep(o
untyped-built-object-parsed.ts	parsed", () => { const o = keep(JSON.parse(text)
untyped-built-object-reduce.ts	reduce into an empty object", () => { const from = JSON.parse(text); const o = keep(Object.keys(from).reduce((all: any, k: string) => { all[k] = from[k]; return all }, {})
untyped-built-object-spread.ts	a spread in untyped code", () => { const spread = (from: any): any => ({ ...from }); const o = keep(spread(JSON.parse(text))
untyped-built-object-structured-clone.ts	structuredClone", () => { const o = keep(structuredClone(JSON.parse(text))`,
      a => `// An object that has every member of its type and was not made in one piece: its members were added one by one, or a built-in made it.
// It travels as \`any\` before a typed function first holds it. The type has more than six members, all of them required.
interface Reading { id: number; at: number; low: number; high: number; mean: number; count: number; unit: string; place: { name: string } }
const text = '{"id":1,"at":0.5,"low":1.5,"high":2.5,"mean":3.5,"count":4,"unit":"C","place":{"name":"roof"}}'
let seen: unknown = null
function use(r: Reading) { seen = r; return r.id + r.at + r.low + r.high + r.mean + r.count + r.unit + r.place.name }
const made: Reading = { id: 9, at: 1.5, low: 2.5, high: 3.5, mean: 4.5, count: 5.5, unit: "F", place: { name: "own" } }
const kept: unknown[] = []
const keep = (o: any): any => { kept.push(o); return o }
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => use(made))
row("${a}); return use(o) + (o === seen) })
`,
    ),
    ...family(
      `parsed-in-container-items-of-body.ts	the items of a body", () => { const body = travel(JSON.parse('{"items":[' + line + "]}")); const items: Message[] = body.items; return items
parsed-in-container-push-of-either.ts	push of either", () => { const a: Message[] = []; for (let i = 0; i < 4; i++) a.push(i % 2 ? own(i) : travel(JSON.parse(line))); return a
parsed-in-container-record-with-array.ts	a record that holds an array", () => { const batch: Batch = travel(JSON.parse('{"name":"b","items":[' + line + "," + withOrigin + "]}")); return batch.name + batch.items
parsed-in-container-whole-array-parsed.ts	a whole array is parsed", () => { const a: Message[] = travel(JSON.parse("[" + line + "," + withOrigin + "]")); a.push(own(1)); return a`,
      a => `// Parsed data that travels as \`any\` and first meets its type inside a container, or below a value that has met its type.
// The type has more than six members; the type of one of its members has two.
interface Origin { source: string; hops: number }
interface Message {
  id: number; at: number; size: number; weight: number; body: string
  origin?: Origin; retries?: number; delay?: number; sentAt?: number; score?: number; tags?: string[]
}
interface Batch { name: string; items: Message[] }
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const withOrigin = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","origin":{"source":"wire","hops":2},"tags":["x","y"]}'
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function own(n: number): Message { return { id: n, at: 1.5, size: 2.5, weight: 3.5, body: "own", retries: n, delay: 0.5, sentAt: 4.5, score: 0.25, tags: ["o"], origin: { source: "own", hops: 1 } } }
function handle(m: Message) {
  return m.id + m.at + m.size + m.weight + m.body + (m.retries ?? 0) + (m.delay ?? "-") + (m.score ?? "") + (m.origin ? m.origin.source + m.origin.hops : "") + (m.tags ? m.tags.length : "")
}
const made = own(9)
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => handle(made))
row("${a}.map(handle).join() })
`,
    ),
    ...family(
      `parsed-in-container-mismatch-throws.ts	what does not match is refused", () => { const a: Message[] = []; a.push(travel(JSON.parse('{"id":"one","at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
parsed-in-container-push.ts	push", () => { const a: Message[] = []; a.push(travel(JSON.parse(line
parsed-in-container-splice.ts	splice", () => { const a: Message[] = [own(1)]; a.splice(0, 1, travel(JSON.parse(line
parsed-in-container-unshift.ts	unshift", () => { const a: Message[] = [own(1)]; a.unshift(travel(JSON.parse(line`,
      a => `// Parsed data that travels as \`any\` and first meets its type inside a container, or below a value that has met its type.
// The type has more than six members; the type of one of its members has two.
interface Origin { source: string; hops: number }
interface Message {
  id: number; at: number; size: number; weight: number; body: string
  origin?: Origin; retries?: number; delay?: number; sentAt?: number; score?: number; tags?: string[]
}
interface Batch { name: string; items: Message[] }
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const withOrigin = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","origin":{"source":"wire","hops":2},"tags":["x","y"]}'
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function own(n: number): Message { return { id: n, at: 1.5, size: 2.5, weight: 3.5, body: "own", retries: n, delay: 0.5, sentAt: 4.5, score: 0.25, tags: ["o"], origin: { source: "own", hops: 1 } } }
function handle(m: Message) {
  return m.id + m.at + m.size + m.weight + m.body + (m.retries ?? 0) + (m.delay ?? "-") + (m.score ?? "") + (m.origin ? m.origin.source + m.origin.hops : "") + (m.tags ? m.tags.length : "")
}
const made = own(9)
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => handle(made))
row("${a}))); return handle(a[0]!) })
`,
    ),
    ...family(
      `parsed-in-container-push-then-for-of.ts	push, then for of", () => { const a: Message[] = []; a.push(travel(JSON.parse(line))); a.push(own(2)); let s = 0; for (const m of a) s += m.id + (m.retries ?? 10); return s
parsed-in-container-push-then-index.ts	push, then by index", () => { const a: Message[] = []; a.push(travel(JSON.parse(line))); a.push(own(2)); let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!.id + (a[i]!.retries ?? 10); return s
parsed-in-container-push-then-reduce.ts	push, then reduce", () => { const a: Message[] = []; a.push(travel(JSON.parse(line))); a.push(own(2)); return a.reduce((s, m) => s + m.id, 0)
parsed-in-container-set.ts	a Set", () => { const all = new Set<Message>(); all.add(travel(JSON.parse(line))); all.add(own(3)); let s = ""; for (const m of all) s += handle(m); return s`,
      a => `// Parsed data that travels as \`any\` and first meets its type inside a container, or below a value that has met its type.
// The type has more than six members; the type of one of its members has two.
interface Origin { source: string; hops: number }
interface Message {
  id: number; at: number; size: number; weight: number; body: string
  origin?: Origin; retries?: number; delay?: number; sentAt?: number; score?: number; tags?: string[]
}
interface Batch { name: string; items: Message[] }
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const withOrigin = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","origin":{"source":"wire","hops":2},"tags":["x","y"]}'
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function own(n: number): Message { return { id: n, at: 1.5, size: 2.5, weight: 3.5, body: "own", retries: n, delay: 0.5, sentAt: 4.5, score: 0.25, tags: ["o"], origin: { source: "own", hops: 1 } } }
function handle(m: Message) {
  return m.id + m.at + m.size + m.weight + m.body + (m.retries ?? 0) + (m.delay ?? "-") + (m.score ?? "") + (m.origin ? m.origin.source + m.origin.hops : "") + (m.tags ? m.tags.length : "")
}
const made = own(9)
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => handle(made))
row("${a} })
`,
    ),
    ...family(
      `method-type-arg-array-element.ts	method of a class passes a record type as an explicit type argument to a generic function as the element type of an array. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answers = await later<{ k: Part }[]>('[{"k": {"id": 1}}]'); return answers[0]!.k
method-type-arg-destructured.ts	method of a class passes a record type as an explicit type argument to a generic function and destructures the result. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const { k } = await later<{ k: Part }>('{"k": {"id": 1}}'); return k
method-type-arg-keeps-identity.ts	method of a class passes a record type as an explicit type argument to a generic function and the result is still the very object that was parsed. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answer = await later<{ k: Part }>('{"k": {"id": 1}}'); answer.k.id = 5; return [answer === seen[0], answer.k === (seen[0] as any).k, JSON.stringify(seen[0])]
method-type-arg-nested.ts	method of a class passes a record type as an explicit type argument to a generic function with another record type nested in it. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answer = await later<{ j: { k: Part } }>('{"j": {"k": {"id": 1}}}'); return answer.j.k
method-type-arg-promise-in-variable.ts	method of a class passes a record type as an explicit type argument to a generic function and keeps the promise in a variable before awaiting it. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const promise = later<{ k: Part }>('{"k": {"id": 1}}'); const answer = await promise; return answer.k
method-type-arg-several.ts	method of a class passes a record type as an explicit type argument to a generic function four times, each with a different record type. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	return [(await later<{ a: Part }>('{"a": {"id": 1}}')).a, (await later<{ b: Part }>('{"b": {"id": 2}}')).b, (await later<{ c: Part[] }>('{"c": [{"id": 3}]}')).c, (await later<{ d: string; e: Part }>('{"d": "d", "e": {}}')).d]
method-type-arg-then-read.ts	method of a class passes a record type as an explicit type argument to a generic function and reads a member of the result. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answer = await later<{ k: Part }>('{"k": {"id": 1}}'); return answer.k
method-type-arg-then-written.ts	method of a class passes a record type as an explicit type argument to a generic function and assigns to a member of the result. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answer = await later<{ k: Part }>('{"k": {"id": 1}}'); answer.k = { id: 9 }; return answer.k
method-type-arg-through-promise-all.ts	method of a class passes a record type as an explicit type argument to a generic function and awaits two such promises with Promise.all. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const [x, y] = await Promise.all([later<{ k: Part }>('{"k": {"id": 1}}'), later<{ j: Part }>('{"j": {"id": 2}}')]); return [x.k, y.j]
method-type-arg-via-local-alias.ts	method of a class passes a record type as an explicit type argument to a generic function through a type alias declared inside the method. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	type Answer = { k: Part }; const answer = await later<Answer>('{"k": {"id": 1}}'); return answer.k
method-type-arg-with-extra-members.ts	method of a class passes a record type as an explicit type argument to a generic function and the data has more members than the type names. Nothing in the program creates an object of that type, and the only cast is \`as R\` inside the generic function. Data from JSON.parse that matches the type must be accepted,	const answer = await later<{ k: Part }>('{"k": {"id": 1}, "j": 2, "extra": [1]}'); return [answer.k, Object.keys(answer), JSON.stringify(answer), answer === seen[0]]
return-only-generic-inline-tagged-union-method.ts	generic function returns Promise<R> and none of its parameters mention R, so only the caller's claim determines R. A method writes a tagged union inline as the type argument. The program must behave	const answer = await later<{ ok: true; k: Part } | { ok: false; e: string }>('{"ok": true, "k": {"id": 1}}'); return answer.ok ? answer.k : answer.e`,
      (a, b) => `// A ${a} as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
type Waiting = { resolve: (result: unknown) => void; reject: (error: unknown) => void }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; a = 5; b = 6; c = 7; d = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.a + unrelated.b + unrelated.c + unrelated.d < 0) console.log('never')
const waiting = new Map<number, Waiting>()
const seen: unknown[] = []
let next = 0
function arrive(id: number, text: string): void {
  const entry = waiting.get(id)
  if (!entry) return
  waiting.delete(id)
  const parsed: unknown = JSON.parse(text)
  seen.push(parsed)
  entry.resolve(parsed)
}
function later<R>(text: string): Promise<R> {
  const id = next++
  Promise.resolve().then(() => arrive(id, text))
  return new Promise<R>((resolve, reject) => {
    waiting.set(id, { resolve: result => resolve(result as R), reject })
  })
}
class Caller { async ask() { ${b} } }
console.log(JSON.stringify(await new Caller().ask()))
`,
    ),
    ...family(
      `return-only-generic-from-generic-caller.ts	only the caller's claim determines R. The caller is generic too and uses its own type parameter in the type argument	inner = async <X,>(x: X): Promise<X> => { const answer = await later<{ k: X }>('{"k": {"id": 1}}'); return answer.k }; return inner<Part>({ id: 2 })
return-only-generic-in-narrowed.ts	only the caller's claim determines R. The type argument is a union that the caller narrows with \`in\`	answer = await later<{ k: Part } | { e: string }>('{"k": {"id": 1}}'); return 'k' in answer ? answer.k : answer.e
return-only-generic-inline-tagged-union.ts	only the caller's claim determines R. The type argument is a tagged union written inline	answer = await later<{ ok: true; k: Part } | { ok: false; e: string }>('{"ok": true, "k": {"id": 1}}'); return answer.ok ? answer.k : answer.e
return-only-generic-member-typed-any.ts	only the caller's claim determines R. The only member of the type argument is typed \`any\`	answer = await later<{ k: any }>('{"k": {"id": 1}}'); return answer.k
return-only-generic-member-wrong-type.ts	R is only what the caller claims. The member has another type than declared. No cast names the record type, so nothing throws, as in plain Bun	answer = await later<{ d: string }>('{"d": 5}'); return typeof answer.d
return-only-generic-missing-member.ts	only the caller's claim determines R. The data lacks the member: it reads undefined, which passes every written type	answer = await later<{ k: Part }>('{"j": 1}'); return typeof answer.k
return-only-generic-result-spread.ts	only the caller's claim determines R. The result is spread into a new object	answer = await later<{ k: Part }>('{"k": {"id": 1}}'); const copy = { ...answer, j: 1 }; return copy.k`,
      (
        a,
        b,
      ) => `// A generic function returns Promise<R> and none of its parameters mention R, so ${a}. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
type Waiting = { resolve: (result: unknown) => void; reject: (error: unknown) => void }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; a = 5; b = 6; c = 7; d = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.a + unrelated.b + unrelated.c + unrelated.d < 0) console.log('never')
const waiting = new Map<number, Waiting>()
const seen: unknown[] = []
let next = 0
function arrive(id: number, text: string): void {
  const entry = waiting.get(id)
  if (!entry) return
  waiting.delete(id)
  const parsed: unknown = JSON.parse(text)
  seen.push(parsed)
  entry.resolve(parsed)
}
function later<R>(text: string): Promise<R> {
  const id = next++
  Promise.resolve().then(() => arrive(id, text))
  return new Promise<R>((resolve, reject) => {
    waiting.set(id, { resolve: result => resolve(result as R), reject })
  })
}
async function ask() { const ${b} }
console.log(JSON.stringify(await ask()))
`,
    ),
    ...family(
      `union-parsed-generic-boolean.ts	a boolean: " + await use(true)) } catch (e) { console.log("a boolean
union-parsed-generic-null.ts	null: " + await use(null)) } catch (e) { console.log("null
union-parsed-generic-number.ts	a number: " + await use(1)) } catch (e) { console.log("a number
union-parsed-generic-object.ts	an object: " + await use({ k: 1 })) } catch (e) { console.log("an object
union-parsed-generic-parsed-data.ts	parsed data: " + await use(Symbol())) } catch (e) { console.log("parsed data
union-parsed-generic-string.ts	a string: " + await use("s")) } catch (e) { console.log("a string`,
      a => `// One generic type, two instantiations: a record is made at \`Routed<T>\` and taken as \`Routed<unknown>\`, both ways by a call by value.
// Somewhere else in the program parsed data is held to the generic one.
type G<T> = { body: T; code: number }
type W = { w: number }
type Result<T> = { ok: true; data: T; status: number; reply: G<T>; mark?: null | string } | { ok: false; reason: "a" } | { ok: false; reason: "b" } | { ok: false; reason: "c"; detail: string }
type Routed<T> = Result<T> & { route: "direct" | "far"; fromFar: boolean; a?: number; b?: W; c?: number; d?: "x" | "y"; e?: number }
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function make<T>(x: T): Result<T> { return typeof x === "boolean" ? { ok: true, data: x, status: 201.5, reply: { body: x, code: 2 }, mark: "m" } : { ok: true, data: x, status: 200.5, reply: { body: x, code: 1 } } }
async function direct<T>(x: T): Promise<Result<T>> { return x === null ? { ok: false, reason: "a" } : make<T>(x) }
async function send<T>(x: T): Promise<Routed<T>> {
  const sendDirect = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "direct", fromFar: true })
  const sendFar = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "far", fromFar: false, a: 1.5, b: { w: 2 }, c: 3.5, d: "x", e: 5.5 })
  const replayed = async (): Promise<Routed<T>> => travel(JSON.parse('{"ok":true,"data":4,"status":1.5,"reply":{"body":4,"code":3},"route":"far","fromFar":true}'))
  return typeof x === "string" ? sendFar() : typeof x === "symbol" ? replayed() : sendDirect()
}
type Taker = (res: Routed<unknown>) => string
const takers: Taker[] = []
takers.push(res => {
  if (!res.ok) return "not ok " + res.reason
  if (!res.fromFar) return "near " + res.a
  return res.status + " " + res.route + " " + JSON.stringify(res.data) + " " + res.reply.code + " " + (res.mark ?? "-") + (res.a ?? "-")
})
const senders: Record<string, <T>(x: T) => Promise<Routed<T>>> = { send }
async function use(x: unknown) {
  let res: Routed<unknown>
  res = await senders.send!<unknown>(x)
  return takers.map(take => take(res)).join()
}
try { console.log("${a}: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
`,
    ),
    ...family(
      `union-parsed-class-arm-boolean.ts	a boolean: " + await use(true)) } catch (e) { console.log("a boolean
union-parsed-class-arm-null.ts	null: " + await use(null)) } catch (e) { console.log("null
union-parsed-class-arm-number.ts	a number: " + await use(1)) } catch (e) { console.log("a number
union-parsed-class-arm-object.ts	an object: " + await use({ k: 1 })) } catch (e) { console.log("an object
union-parsed-class-arm-string.ts	a string: " + await use("s")) } catch (e) { console.log("a string
union-parsed-class-arm-undefined.ts	undefined: " + await use(undefined)) } catch (e) { console.log("undefined`,
      a => `// A union of four records. Parsed data is held to it in one place; in another a record is made for it by a spread.
// One arm holds an object of a class; the other three hold data alone.
class Reply<T> { constructor(public body: T, public code: number) {} text() { return String(this.code) } }
type W = { w: number }
type Result<T> = { ok: true; data: T; status: number; reply: Reply<T>; mark?: null | string } | { ok: false; reason: "a" } | { ok: false; reason: "b" } | { ok: false; reason: "c"; detail: string }
type Routed<T> = Result<T> & { route: "direct" | "far"; fromFar: boolean; a?: number; b?: W; c?: number; d?: "x" | "y"; e?: number }
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function make<T>(x: T): Result<T> { return typeof x === "boolean" ? { ok: true, data: x, status: 201.5, reply: new Reply(x, 2), mark: "m" } : { ok: true, data: x, status: 200.5, reply: new Reply(x, 1) } }
async function direct<T>(x: T): Promise<Result<T>> { return x === null ? { ok: false, reason: "a" } : x === undefined ? { ok: false, reason: "c", detail: "none" } : make<T>(x) }
function client() {
  return {
    get: async <T,>(x: T): Promise<Routed<T>> => {
      const sendDirect = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "direct", fromFar: true })
      const sendFar = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "far", fromFar: false, a: 1.5, b: { w: 2 }, c: 3.5, d: "x", e: 5.5 })
      return typeof x === "string" ? sendFar() : sendDirect()
    },
  }
}
const api = client()
async function use(x: unknown) {
  let res: Routed<unknown>
  res = await api.get<unknown>(x)
  if (!res.ok) return "not ok " + res.reason
  if (!res.fromFar) return "near " + res.a
  return res.status + " " + res.route + " " + JSON.stringify(res.data) + " " + res.reply.text() + " " + (res.mark ?? "-") + (res.a ?? "-")
}
function replayed(text: string) {
  const boot: Routed<unknown> = travel(JSON.parse(text))
  return boot.ok ? "ok" : boot.reason === "c" ? boot.reason + boot.detail + boot.route : boot.reason + boot.route
}
try { console.log("parsed data: " + replayed('{"ok":false,"reason":"c","detail":"d","route":"far","fromFar":false}')) } catch (e) { console.log("parsed data: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
try { console.log("${a}: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
`,
    ),
    ...family(
      `json-parse-type-argument-while-the-collector-runs-1.ts	1 declared field			kid: Level2	1	leaf.f0
json-parse-type-argument-while-the-collector-runs-200.ts	200 declared fields	; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; f64: number; f65: string; f66: boolean; f67: string[]; f68: number; f69: string | null; f70: string; f71: number; f72: string; f73: boolean; f74: string[]; f75: number; f76: string | null; f77: string; f78: number; f79: string; f80: boolean; f81: string[]; f82: number; f83: string | null; f84: string; f85: number; f86: string; f87: boolean; f88: string[]; f89: number; f90: string | null; f91: string; f92: number; f93: string; f94: boolean; f95: string[]; f96: number; f97: string | null; f98: string; f99: number; f100: string; f101: boolean; f102: string[]; f103: number; f104: string | null; f105: string; f106: number; f107: string; f108: boolean; f109: string[]; f110: number; f111: string | null; f112: string; f113: number; f114: string; f115: boolean; f116: string[]; f117: number; f118: string | null; f119: string; f120: number; f121: string; f122: boolean; f123: string[]; f124: number; f125: string | null; f126: string; f127: number; f128: string; f129: boolean; f130: string[]; f131: number; f132: string | null; f133: string; f134: number; f135: string; f136: boolean; f137: string[]; f138: number; f139: string | null; f140: string; f141: number; f142: string; f143: boolean; f144: string[]; f145: number; f146: string | null; f147: string; f148: number; f149: string; f150: boolean; f151: string[]; f152: number; f153: string | null; f154: string; f155: number; f156: string; f157: boolean; f158: string[]; f159: number; f160: string | null; f161: string; f162: number; f163: string; f164: boolean; f165: string[]; f166: number; f167: string | null; f168: string; f169: number; f170: string; f171: boolean; f172: string[]; f173: number; f174: string | null; f175: string; f176: number; f177: string; f178: boolean; f179: string[]; f180: number; f181: string | null; f182: string; f183: number; f184: string; f185: boolean; f186: string[]; f187: number; f188: string | null; f189: string; f190: number; f191: string; f192: boolean; f193: string[]; f194: number; f195: string | null; f196: string; f197: number; f198: string; f199: boolean	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; f64: number; f65: string; f66: boolean; f67: string[]; f68: number; f69: string | null; f70: string; f71: number; f72: string; f73: boolean; f74: string[]; f75: number; f76: string | null; f77: string; f78: number; f79: string; f80: boolean; f81: string[]; f82: number; f83: string | null; f84: string; f85: number; f86: string; f87: boolean; f88: string[]; f89: number; f90: string | null; f91: string; f92: number; f93: string; f94: boolean; f95: string[]; f96: number; f97: string | null; f98: string; f99: number; f100: string; f101: boolean; f102: string[]; f103: number; f104: string | null; f105: string; f106: number; f107: string; f108: boolean; f109: string[]; f110: number; f111: string | null; f112: string; f113: number; f114: string; f115: boolean; f116: string[]; f117: number; f118: string | null; f119: string; f120: number; f121: string; f122: boolean; f123: string[]; f124: number; f125: string | null; f126: string; f127: number; f128: string; f129: boolean; f130: string[]; f131: number; f132: string | null; f133: string; f134: number; f135: string; f136: boolean; f137: string[]; f138: number; f139: string | null; f140: string; f141: number; f142: string; f143: boolean; f144: string[]; f145: number; f146: string | null; f147: string; f148: number; f149: string; f150: boolean; f151: string[]; f152: number; f153: string | null; f154: string; f155: number; f156: string; f157: boolean; f158: string[]; f159: number; f160: string | null; f161: string; f162: number; f163: string; f164: boolean; f165: string[]; f166: number; f167: string | null; f168: string; f169: number; f170: string; f171: boolean; f172: string[]; f173: number; f174: string | null; f175: string; f176: number; f177: string; f178: boolean; f179: string[]; f180: number; f181: string | null; f182: string; f183: number; f184: string; f185: boolean; f186: string[]; f187: number; f188: string | null; f189: string; f190: number; f191: string; f192: boolean; f193: string[]; f194: number; f195: string | null; f196: string; f197: number; f198: string; 	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; f64: number; f65: string; f66: boolean; f67: string[]; f68: number; f69: string | null; f70: string; f71: number; f72: string; f73: boolean; f74: string[]; f75: number; f76: string | null; f77: string; f78: number; f79: string; f80: boolean; f81: string[]; f82: number; f83: string | null; f84: string; f85: number; f86: string; f87: boolean; f88: string[]; f89: number; f90: string | null; f91: string; f92: number; f93: string; f94: boolean; f95: string[]; f96: number; f97: string | null; f98: string; f99: number; kid: Level2; f101: boolean; f102: string[]; f103: number; f104: string | null; f105: string; f106: number; f107: string; f108: boolean; f109: string[]; f110: number; f111: string | null; f112: string; f113: number; f114: string; f115: boolean; f116: string[]; f117: number; f118: string | null; f119: string; f120: number; f121: string; f122: boolean; f123: string[]; f124: number; f125: string | null; f126: string; f127: number; f128: string; f129: boolean; f130: string[]; f131: number; f132: string | null; f133: string; f134: number; f135: string; f136: boolean; f137: string[]; f138: number; f139: string | null; f140: string; f141: number; f142: string; f143: boolean; f144: string[]; f145: number; f146: string | null; f147: string; f148: number; f149: string; f150: boolean; f151: string[]; f152: number; f153: string | null; f154: string; f155: number; f156: string; f157: boolean; f158: string[]; f159: number; f160: string | null; f161: string; f162: number; f163: string; f164: boolean; f165: string[]; f166: number; f167: string | null; f168: string; f169: number; f170: string; f171: boolean; f172: string[]; f173: number; f174: string | null; f175: string; f176: number; f177: string; f178: boolean; f179: string[]; f180: number; f181: string | null; f182: string; f183: number; f184: string; f185: boolean; f186: string[]; f187: number; f188: string | null; f189: string; f190: number; f191: string; f192: boolean; f193: string[]; f194: number; f195: string | null; f196: string; f197: number; f198: string; f199: boolean	200	String(leaf.f199)
json-parse-type-argument-while-the-collector-runs-6.ts	6 declared fields	; f1: number; f2: string; f3: boolean; f4: string[]; f5: number	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; 	f0: string; f1: number; f2: string; kid: Level2; f4: string[]; f5: number	6	String(leaf.f5)
json-parse-type-argument-while-the-collector-runs-64.ts	64 declared fields	; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; 	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; kid: Level2; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string	64	leaf.f63
json-parse-type-argument-while-the-collector-runs-65.ts	65 declared fields	; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; f64: number	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; f32: string[]; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; 	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null; f7: string; f8: number; f9: string; f10: boolean; f11: string[]; f12: number; f13: string | null; f14: string; f15: number; f16: string; f17: boolean; f18: string[]; f19: number; f20: string | null; f21: string; f22: number; f23: string; f24: boolean; f25: string[]; f26: number; f27: string | null; f28: string; f29: number; f30: string; f31: boolean; kid: Level2; f33: number; f34: string | null; f35: string; f36: number; f37: string; f38: boolean; f39: string[]; f40: number; f41: string | null; f42: string; f43: number; f44: string; f45: boolean; f46: string[]; f47: number; f48: string | null; f49: string; f50: number; f51: string; f52: boolean; f53: string[]; f54: number; f55: string | null; f56: string; f57: number; f58: string; f59: boolean; f60: string[]; f61: number; f62: string | null; f63: string; f64: number	65	String(leaf.f64)
json-parse-type-argument-while-the-collector-runs-7.ts	7 declared fields	; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; f6: string | null	f0: string; f1: number; f2: string; f3: boolean; f4: string[]; f5: number; 	f0: string; f1: number; f2: string; kid: Level2; f4: string[]; f5: number; f6: string | null	7	String(leaf.f6)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
      ) => `// Records of ${a} and as many undeclared keys, four deep, in arrays, tuples and dictionaries, are parsed by \`JSON.parse(text) as T\` while the collector runs as often as it can be made to.
interface Level1 { f0: string${b} }
interface Level2 { ${c}kid: Level1 }
interface Level3 { ${d} }
interface Level4 { kid: Level3${b} }
const width: number = ${e};
const lastOf = (leaf: Level1): string => ${f};
interface Holder { list: Level4[]; pair: [Level4, Level3, string]; byName: Record<string, Level4>; one: Level4; rows: Level2[][] }

const plainParse: (text: string) => any = JSON.parse;
const few = width > 7;
let seed = 7;
let serial = 0;
let recordsBuilt = 0;

function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}

function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}

function declaredValue(at: number): string {
  switch (width === 1 ? 0 : at % 7) {
    case 0:
    case 2:
      return longText();
    case 1:
      return String(++serial * 3);
    case 3:
      return at % 2 ? "true" : "false";
    case 4:
      return "[" + longText() + "," + longText() + "]";
    case 5:
      return ++serial + ".5";
    default:
      return ++serial % 2 ? "null" : longText();
  }
}

function undeclaredValue(at: number): string {
  switch (at % 5) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + ',{"c":' + longText() + "}]}";
    case 2:
      return String(++serial);
    case 3:
      return "[" + longText() + ",[" + longText() + "],{}]";
    default:
      return '"s' + (at % 3) + '"';
  }
}

function kidAt(level: number): number {
  return level === 4 ? 0 : level === 3 ? width >> 1 : width - 1;
}

function record(level: number, undeclared: number, shuffled: boolean): string {
  const number = ++recordsBuilt;
  const marked = level > 1 && kidAt(level) === width - 1 ? width - 2 : width - 1;
  const declared: string[] = [];
  for (let at = 0; at < width; at++) {
    if (level > 1 && at === kidAt(level)) declared.push('"kid":' + record(level - 1, undeclared, shuffled));
    else if (at === marked) declared.push("\\u0001" + number + '\\u0002"f' + at + '"\\u0003:' + declaredValue(at) + "\\u0004");
    else declared.push('"f' + at + '":' + declaredValue(at));
  }
  const others: string[] = [];
  if (undeclared) for (let at = 0; at < width; at++) others.push('"u' + at + '":' + undeclaredValue(at));
  let members: string[] = [];
  if (undeclared === 1) members = [...declared, ...others];
  else if (undeclared === 2) members = [...others, ...declared];
  else for (let at = 0; at < declared.length || at < others.length; at++) members.push(...declared.slice(at, at + 1), ...others.slice(at, at + 1));
  if (shuffled) {
    for (let at = members.length - 1; at > 0; at--) {
      const other = random(at + 1);
      const held = members[at];
      members[at] = members[other];
      members[other] = held;
    }
  }
  return "{" + members.join(",") + "}";
}

function holder(undeclared: number, shuffled: boolean): string {
  recordsBuilt = 0;
  const level4 = () => record(4, undeclared, shuffled);
  const list = few ? [level4()] : [level4(), level4()];
  const pair = [level4(), record(3, undeclared, shuffled), longText()];
  const byName = few ? ['"a name that is long enough to be no short string ' + ++serial + '":' + level4()] : ['"a name that is long enough to be no short string ' + ++serial + '":' + level4(), '"n":' + level4()];
  const rows = few ? [[], [record(2, undeclared, shuffled)]] : [[record(2, undeclared, shuffled)], [], [record(2, undeclared, shuffled), record(2, undeclared, shuffled)]];
  return '{"list":[' + list.join(",") + '],"pair":[' + pair.join(",") + '],"byName":{' + byName.join(",") + '},"one":' + level4() + ',"rows":[' + rows.map(row => "[" + row.join(",") + "]").join(",") + "]}";
}

const marks = /\\u0001[0-9]+\\u0002|[\\u0003\\u0004]/g;

function withFault(marked: string, number: number, kind: string): string {
  const start = marked.indexOf("\\u0001" + number + "\\u0002");
  if (start < 0) return "";
  const keyStart = marked.indexOf("\\u0002", start) + 1;
  const keyEnd = marked.indexOf("\\u0003", keyStart);
  const end = marked.indexOf("\\u0004", keyEnd);
  const key = marked.slice(keyStart, keyEnd);
  const value = marked.slice(keyEnd + 2, end);
  let member = "";
  if (kind === "misfit") member = key + ":" + (value[0] === "[" || value[0] === '"' ? "{}" : "[" + value + "]");
  else if (kind === "missing") member = '"other":' + value;
  else if (kind === "token") member = key + ":" + value + "@";
  else if (kind === "end") return marked.slice(0, end).replace(marks, "");
  else if (kind === "escaped key") member = '"\\\\u0066' + key.slice(2) + ":" + value;
  else if (kind === "twice") member = key + ":" + value + "," + key + ":" + value;
  else member = '"__proto__":{"p":' + value + "}," + key + ":" + value + ',"7":' + value + ',"":' + value;
  return (marked.slice(0, start) + member + marked.slice(end)).replace(marks, "");
}

function spaced(text: string): string {
  const pieces: string[] = [];
  let from = 0;
  let inString = false;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (inString) {
      if (code === 92) at++;
      else if (code === 34) inString = false;
    } else if (code === 34) inString = true;
    else if (code === 44 || code === 58 || code === 123 || code === 91 || code === 125 || code === 93) {
      pieces.push(text.slice(from, at), at % 3 ? " " : "\\n\\t", text[at], at % 2 ? "\\r\\n" : " ");
      from = at + 1;
    }
  }
  pieces.push(text.slice(from));
  return pieces.join("");
}

function probe(value: Holder): number {
  let found = value.one.kid.kid.kid.f0.length + value.pair[2].charCodeAt(13) + lastOf(value.pair[1].kid.kid).length;
  for (const item of value.list) found += item.kid.kid.kid.f0.charCodeAt(14) + lastOf(item.kid.kid.kid).length;
  for (const name in value.byName) found += name.length + value.byName[name].kid.kid.kid.f0.charCodeAt(13);
  for (const row of value.rows) for (const item of row) found += item.kid.f0.charCodeAt(14);
  return found;
}

const kept: { value: Holder; written: string; probed: number }[] = [];

function keptStillStand(): string {
  let lost = 0;
  for (const entry of kept) if (JSON.stringify(entry.value) !== entry.written || probe(entry.value) !== entry.probed) lost++;
  const checked = kept.length;
  if (checked > 3) kept.splice(0, checked - 3);
  return lost + " of " + checked + " kept ones lost";
}

function section(label: string, undeclared: number, shuffled: boolean, withSpaces: boolean): void {
  const marked = holder(undeclared, shuffled);
  const records = recordsBuilt;
  const compact = marked.replace(marks, "");
  const text = withSpaces ? spaced(compact) : compact;
  let different = 0;
  const probed = probe(plainParse(compact));
  for (let round = 0; round < 2; round++) {
    const value = JSON.parse(text) as Holder;
    if (JSON.stringify(value) !== compact || probe(value) !== probed) different++;
    kept.push({ value, written: compact, probed });
  }
  console.log(label + ": " + different + " differ, " + keptStillStand());
  for (const kind of few ? ["misfit", "end", "escaped key", "odd keys"] : ["misfit", "missing", "token", "end", "escaped key", "twice", "odd keys"]) {
    let texts = 0;
    let values = 0;
    let syntaxErrors = 0;
    different = 0;
    for (let number = records; number > 0; number -= records >> 1) {
      let faulty = withFault(marked, number, kind);
      if (faulty === "") continue;
      if (withSpaces) faulty = spaced(faulty);
      texts++;
      let expected = "";
      let plain: any;
      try {
        plain = plainParse(faulty);
        expected = JSON.stringify(plain);
      } catch (error: any) {
        expected = error.name + ": " + error.message;
      }
      try {
        const value = JSON.parse(faulty) as Holder;
        values++;
        if (JSON.stringify(value) !== expected || probe(value) !== probe(plain)) different++;
        if (texts === 1) kept.push({ value, written: expected, probed: probe(plain) });
      } catch (error: any) {
        if (error.name === "SyntaxError") {
          syntaxErrors++;
          if (error.name + ": " + error.message !== expected) different++;
        } else different++;
      }
    }
    console.log(label + ", " + kind + ": " + texts + " texts: " + values + " values, " + syntaxErrors + " syntax errors, " + different + " differ, " + keptStillStand());
  }
}

const sections: [string, number, boolean, boolean][] = [
  ["declared order", 0, false, false],
  ["shuffled", 0, true, false],
  ["spaced", 0, false, true],
  ["undeclared keys behind", 1, false, false],
  ["undeclared keys in front", 2, false, false],
  ["undeclared keys between", 3, false, false],
  ["undeclared keys, shuffled", 3, true, false],
  ["undeclared keys, shuffled and spaced", 3, true, true],
];
sections.forEach(([label, undeclared, shuffled, withSpaces], at) => {
  if (!few || at === 0 || at === 1 || at === 5 || at === 7) section(label, undeclared, shuffled, withSpaces);
});
`,
    ),
  });
