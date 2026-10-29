// Fields and keys that no class declares are added, deleted and created again in drawn orders, integer keys and symbols among them, on objects of a few keys and of hundreds. Every way of listing the keys is printed as a hash.
const tag = Symbol("tag");
class Record { first = 1; second = "s"; third?: number; fourth?: string; }
class Tagged { one = 1; [tag] = "t"; two?: string; three = 3; }
class Base { low = 0; mid?: number; }
class Derived extends Base { high = "h"; top?: boolean; }
class Built { x: number; y: number; z?: number; constructor() { this.x = 1; this.y = 2; } }
const makers: (() => any)[] = [
  () => new Record(), () => new Tagged(), () => new Derived(), () => new Built(),
  () => ({ a: 1, b: "two", c: 3 }), () => ({ only: 1 }), () => ({}),
];
const fieldsOf: string[][] = [["first", "second", "third", "fourth"], ["one", "two", "three"], ["low", "mid", "high", "top"], ["x", "y", "z"], ["a", "b", "c"], ["only"], []];
let seed = 1;
function random(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}
function hashOf(texts: string[]): number {
  let hash = 0;
  for (const text of texts) {
    for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    hash = (Math.imul(hash, 31) + 7) | 0;
  }
  return hash;
}
const verbose = false;
function show(name: string, texts: string[]): string {
  return verbose ? name + "[" + texts.join() + "]" : name + texts.length + ":" + hashOf(texts);
}
function listings(o: any, which: number): string {
  const parts: string[] = [];
  if (which & 1) parts.push(show("own", Reflect.ownKeys(o).map(String)));
  if (which & 2) parts.push(show("keys", Object.keys(o)));
  if (which & 4) { const seen: string[] = []; for (const key in o) seen.push(key); parts.push(show("in", seen)); }
  if (which & 8) { let text: string; try { text = JSON.stringify(o); } catch (e) { text = "throws"; } parts.push(show("json", [text])); }
  if (which & 16) { let copy: any; try { copy = { ...o }; parts.push(show("spread", Reflect.ownKeys(copy).map(String))); } catch (e) { parts.push("spread throws"); } }
  if (which & 32) parts.push(show("names", Object.getOwnPropertyNames(o)), show("symbols", Object.getOwnPropertySymbols(o).map(String)));
  if (which & 64) { try { parts.push(show("entries", Object.entries(o).map(([k, v]) => k + "=" + String(v)))); } catch (e) { parts.push("entries throw"); } }
  if (which & 128) { try { parts.push(show("assign", Object.keys(Object.assign({}, o)))); } catch (e) { parts.push("assign throws"); } }
  if (which & 256) { try { parts.push(show("values", Object.values(o).map(String))); } catch (e) { parts.push("values throw"); } }
  if (which & 512) parts.push(show("descriptors", Object.entries(Object.getOwnPropertyDescriptors(o)).map(([k, d]: [string, any]) => k + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : "") + (d.get ? "g" : ""))));
  return parts.join(" ");
}
const symbols = [Symbol.for("s0"), Symbol.for("s1"), Symbol("local"), tag, Symbol.iterator];
function valueFor(step: number): unknown {
  switch (random(6)) {
    case 0: return step;
    case 1: return "text" + step;
    case 2: return undefined;
    case 3: return null;
    case 4: return step / 2;
    default: return step & 1 ? true : { nested: step };
  }
}
function run(theSeed: number, steps: number): string {
  seed = theSeed * 2654435 + 1;
  const kind = random(makers.length);
  const fields = fieldsOf[kind];
  const o: any = makers[kind]();
  const alive: number[] = [];
  let next = 0;
  const size = [0, 3, 20, 60, 66, 130, 700][random(7)];
  const lines: string[] = [];
  const log: string[] = [];
  const note = (text: string) => { if (verbose) log.push(text); };
  const addKey = () => { o["k" + next] = next; alive.push(next); note("add k" + next); next++; };
  const early = random(3) === 0 ? random(size + 1) : size;
  for (let i = 0; i < early; i++) addKey();
  for (let step = 0; step < steps; step++) {
    const choice = random(100);
    const field = fields.length ? fields[random(fields.length)] : "none";
    try {
      if (choice < 22) addKey();
      else if (choice < 44) {
        if (alive.length) {
          const how = random(4);
          const at = how === 0 ? alive.length - 1 : how === 1 ? 0 : random(alive.length);
          note("delete k" + alive[at]);
          if (delete o["k" + alive[at]]) alive.splice(at, 1);
        }
      } else if (choice < 52) { note("delete " + field); delete o[field]; }
      else if (choice < 62) { const value = valueFor(step); note("store " + field + " " + String(value)); o[field] = value; }
      else if (choice < 66) { note("again " + field); delete o[field]; o[field] = step; }
      else if (choice < 69) {
        note("static");
        if (kind === 0) { if (step & 1) { delete o.second; o.second = "again"; } else o.third = step; }
        else if (kind === 3) { if (step & 1) o.z = step; else delete o.z; }
        else if (kind === 4) { delete o.b; o.b = "b" + step; }
      } else if (choice < 72) { const s = symbols[random(symbols.length)]; note("symbol " + String(s)); o[s] = step; }
      else if (choice < 74) { const s = symbols[random(symbols.length)]; note("delete symbol " + String(s)); delete o[s]; }
      else if (choice < 76) { const index = random(12) * (random(4) === 0 ? 1000 : 1); note("index " + index); o[index] = step; }
      else if (choice < 77) { const index = random(12); note("delete index " + index); delete o[index]; }
      else if (choice < 79) {
        const name = random(2) && alive.length ? "k" + alive[random(alive.length)] : field;
        const form = random(5);
        note("define " + name + " " + form);
        if (form === 0) Object.defineProperty(o, name, { get() { return 9; }, enumerable: true, configurable: true });
        else if (form === 1) Object.defineProperty(o, name, { value: step, enumerable: false, writable: true, configurable: true });
        else if (form === 2) Object.defineProperty(o, name, { value: step, enumerable: true, writable: false, configurable: true });
        else if (form === 3) Object.defineProperty(o, name, { value: step, enumerable: true, writable: true, configurable: true });
        else if (random(4) === 0) Object.defineProperty(o, name, { value: step, enumerable: true, writable: true, configurable: false });
      } else if (choice < 80) { note("many"); for (let i = random(90); i > 0; i--) addKey(); }
      else if (choice < 81) { note("many go"); for (let i = random(90); i > 0 && alive.length; i--) { const at = random(2) ? alive.length - 1 : random(alive.length); if (delete o["k" + alive[at]]) alive.splice(at, 1); } }
      else if (choice < 82) { const form = random(12); note("prototype " + form); if (form === 0) Object.setPrototypeOf(o, { inherited: 1 }); else if (form === 1) Object.setPrototypeOf(o, null); else if (form === 2) Object.create(o); }
      else if (choice < 83) { if (random(6) === 0) { note("gc"); Bun.gc(true); } }
      else if (choice < 84) { const form = random(40); note("integrity " + form); if (form === 0) Object.preventExtensions(o); else if (form === 1) Object.seal(o); else if (form === 2) Object.freeze(o); }
      else if (choice < 86) { note("absent"); delete o["absent" + step]; }
      else if (choice < 88) { if (alive.length) { const name = "k" + alive[random(alive.length)]; note("store " + name); o[name] = step; } }
      else if (choice < 90) {
        const source: any = {};
        for (let i = random(4); i >= 0; i--) { if (random(2)) { source["k" + next] = next; alive.push(next++); } else source[fields.length ? fields[random(fields.length)] : "none"] = step + i; }
        note("assign " + Object.keys(source).join());
        if (random(2)) Object.assign(o, source); else Object.defineProperties(o, Object.getOwnPropertyDescriptors(source));
      }
      else lines.push(step + " " + listings(o, 1 << random(10) | 1 << random(10)));
    } catch (e) { lines.push(step + " threw " + (e as Error).constructor.name); }
    if (verbose && log.length) { lines.push("  " + log.join(" . ")); log.length = 0; }
  }
  lines.push("end " + listings(o, 1023));
  return verbose ? lines.join("\n") : theSeed + " " + kind + " " + size + " " + hashOf(lines) + " " + lines[lines.length - 1].slice(0, 60);
}
const first = 1, count = 120, steps = 250;
const out: string[] = [];
for (let s = first; s < first + count; s++) out.push(run(s, steps));
console.log(out.join("\n"));
