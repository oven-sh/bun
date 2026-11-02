// Every kind of object of ours gets elements of every kind of storage, then names, in turns; everything is read back.
type Rec = { a: number; b: string };
class Inst { p = 1; q = "q"; m() { return this.p; } }
class Wide { f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; }
function plainFunction() { return 1; }
const kinds: Array<[string, () => any]> = [
  ["record", () => { const r: Rec = { a: 1, b: "b" }; return r; }],
  ["instance", () => new Inst()],
  ["wide instance", () => new Wide()],
  ["function", () => function () { return 2; }],
  ["arrow", () => () => 3],
  ["bound", () => plainFunction.bind(null)],
  ["class", () => class Local { static s = 1; }],
  ["prototype of a class", () => (class Local2 { m() { return 1; } }).prototype],
  ["prototype of a function", () => (function F() {}).prototype],
  ["untyped literal", () => JSON.parse('{"a":1,"b":"b"}')],
  ["method", () => ({ m() { return 4; } }).m],
  ["async function", () => async function () {}],
  ["generator function", () => function* () {}],
];
const elements: Array<[string, (o: any) => void]> = [
  ["none", () => {}],
  ["int32", o => { o[7] = 7; }],
  ["double", o => { o[0] = 0.5; o[1] = 1.5; }],
  ["values", o => { o[0] = "s"; o[2] = {}; }],
  ["sparse", o => { o[100000] = "far"; o[3] = 3; }],
  ["largest index", o => { o[4294967294] = "last"; o[4294967295] = "a name"; }],
  ["deleted", o => { o[5] = 5; delete o[5]; }],
  ["defined", o => { try { Object.defineProperty(o, "4", { value: "d", writable: true, enumerable: true, configurable: true }); } catch (e) { o[4] = "d"; } }],
];
function check(o: any, count: number): string {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += o["n" + i] === i * 3 ? 1 : 0;
  const indices = Object.keys(o).filter(key => /^\d+$/.test(key)).map(key => key + "=" + String(o[key] && typeof o[key] === "object" ? "o" : o[key])).join();
  return sum + "/" + count + " " + indices;
}
let lines = 0, digest = 0;
const kept: any[] = [];
for (const [kind, make] of kinds) {
  for (const [how, store] of elements) {
    for (const order of [0, 1, 2]) {
      const o = make();
      if (order === 0) store(o);
      let said = "";
      try {
        for (let i = 0; i < 40; i++) {
          if (order === 1 && i === 6) store(o);
          if (order === 2 && i === 33) store(o);
          if (i % 3 === 0) o["n" + i] = i * 3;
          else if (i % 3 === 1) Object.defineProperty(o, "n" + i, { value: i * 3, writable: true, enumerable: true, configurable: true });
          else Object.assign(o, { ["n" + i]: i * 3 });
        }
        said = check(o, 40);
      } catch (e) { said = (e as Error).constructor.name; }
      kept.push(o);
      const copy = (() => { try { return check({ ...o }, 40); } catch (e) { return (e as Error).constructor.name; } })();
      const line = kind + " | " + how + " | " + order + ": " + said + " ; " + copy;
      for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
      lines++;
      if (said !== "40/40 " + said.slice(6) || order === 0) console.log(line);
    }
  }
}
let again = 0;
for (const o of kept) again += check(o, 40).startsWith("40/40") ? 1 : 0;
console.log(lines, digest, again);
