// Objects of many makes go through random steps (defineProperty with every mix of attributes, accessors, freeze, seal, preventExtensions, delete, add, delete and add again),
// and after each few steps every kind of copy is made of them, alone and two at a time. What each copy looks like, with its order of keys and its descriptors, goes into a sum.
// The steps come from a generator with a fixed seed, so plain Bun and the executable do the same.
interface Row { a: number; b?: string; c?: number; d?: boolean }
interface Wide extends Row { label: number }
class Point implements Row { a: number; b?: string; c?: number; d?: boolean; constructor(a: number) { this.a = a; } get twice() { return this.a * 2; } }
class Deep extends Point { e = "e"; constructor(a: number) { super(a); this.c = a + 1; } }

let seed = Number(process.argv[3] ?? "20261030");
function next(n: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % n;
}

const parent = { inherited: 1 };
const tag = Symbol("tag");
const makers: ((v: number) => any)[] = [
  v => ({ a: v }) as Row,
  v => ({ a: v, b: "b" + v }) as Row,
  v => ({ d: true, a: v }) as Row,
  v => ({ c: v, b: "x", a: v, d: false }) as Row,
  v => ({ a: v, z: v + 1, y: "y" }),
  v => new Point(v),
  v => new Deep(v),
  v => JSON.parse(`{"a":${v},"b":"p"}`),
  v => JSON.parse(`{"q":1,"a":${v},"r":2,"s":3,"t":4,"u":5,"w":6,"x":7}`),
  v => Object.assign(Object.create(parent), { a: v }),
  v => { const made: any = {}; for (const name of ["d", "a", "k" + (v % 3)]) made[name] = v; return made; },
  v => ({ a: v, get b() { return "got" + v; } }),
  v => ({ a: v, [tag]: v, 1: "one", 0: "zero" }),
  v => Object.create(null, { a: { value: v, enumerable: true, writable: true, configurable: true } }),
];
const names = ["a", "b", "c", "d", "z", "late", "k0"];

function step(o: any, log: string[]) {
  const name = names[next(names.length)];
  const v = next(1000);
  try {
    switch (next(14)) {
      case 0: Object.defineProperty(o, name, { value: v, enumerable: next(2) === 0, writable: next(2) === 0, configurable: next(2) === 0 }); break;
      case 1: Object.defineProperty(o, name, { enumerable: next(2) === 0 }); break;
      case 2: Object.defineProperty(o, name, { get() { return v; }, enumerable: next(2) === 0, configurable: true }); break;
      case 3: delete o[name]; break;
      case 4: { const had = o[name]; delete o[name]; o[name] = had ?? v; break; }
      case 5: o[name] = name === "b" ? "s" + v : name === "d" ? v % 2 === 0 : v; break;
      case 6: o[name] = [undefined, null, "text", 1.5, { n: v }, [v], () => v][next(7)]; break;
      case 7: if (next(6) === 0) Object.freeze(o); break;
      case 8: if (next(6) === 0) Object.seal(o); break;
      case 9: if (next(6) === 0) Object.preventExtensions(o); break;
      case 10: o["n" + next(5)] = v; break;
      case 11: o[tag] = v; break;
      case 12: o[next(3)] = v; break;
      case 13: Object.defineProperty(o, name, { writable: false }); break;
    }
  } catch (error) {
    log.push((error as Error).constructor.name);
  }
}

function look(o: any): string {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key)!;
    const value = "value" in d ? (typeof d.value === "function" ? "fn" : JSON.stringify(d.value)) : "get";
    parts.push(String(key) + "=" + value + (d.enumerable ? "e" : "") + (d.writable ? "w" : "") + (d.configurable ? "c" : ""));
  }
  return parts.join(",") + "|" + (Object.getPrototypeOf(o) === Object.prototype) + Object.isExtensible(o);
}

const alone = (s: Row): Row => ({ ...s });
const inFront = (s: Row, i: number): Wide => ({ ...s, label: i });
const behind = (s: Row, i: number): Wide => ({ label: i, ...s });
const join = (s: Row, u: Row): Row => ({ ...s, ...u });
const joinWide = (s: Row, u: Row, i: number): Wide => ({ ...s, label: i, ...u });
const over = (s: Row): Row => ({ b: "default", c: 1, ...s });
const copies: ((s: any, u: any, i: number) => any)[] = [
  s => alone(s),
  (s, _, i) => inFront(s, i),
  (s, _, i) => behind(s, i),
  (s, u) => join(s, u),
  (s, u, i) => joinWide(s, u, i),
  s => over(s),
  s => ({ ...s }),
  (s, _, i) => ({ ...s, label: i }),
  (s, _, i) => ({ label: i, ...s }),
  (s, u) => ({ ...s, ...u }),
  (s, u) => ({ ...s, ...(null as any), ...u, ...(undefined as any) }),
  s => { const { a, ...rest } = s; return rest; },
  s => { const { a, b, c, d, ...rest } = s; return rest; },
  (s, _, i) => { const { [names[i % names.length]]: out, ...rest } = s; return rest; },
  s => Object.assign({}, s),
  (s, u) => Object.assign({}, s, u),
  (s, _, i) => Object.assign({ label: i }, s),
  (s, u, i) => Object.assign({ label: i, a: -1 }, s, null, u),
  (s, u) => Object.assign(alone(u), s),
  (s, u) => Object.assign(new Point(1), s, u),
  (s, u) => Object.assign(JSON.parse("{}"), u, s),
];

const pool: any[] = [];
for (let i = 0; i < 40; i++) pool.push(makers[i % makers.length](i));
let sum = 0;
const log: string[] = [];
function add(text: string) {
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
}
const rounds = Number(process.argv[2] ?? "12000");
for (let round = 1; round <= rounds; round++) {
  const at = next(pool.length);
  if (next(25) === 0) pool[at] = makers[next(makers.length)](round);
  else if (next(3) === 0) step(pool[at], log);
  const s = pool[next(pool.length)];
  const u = pool[next(pool.length)];
  // The same kind of copy several times in a row: the first few are made in other ways than the rest.
  const copy = copies[next(copies.length)];
  for (let again = next(5); again >= 0; again--) {
    let made: any;
    try {
      made = copy(s, u, round);
    } catch (error) {
      add((error as Error).constructor.name);
      continue;
    }
    add(look(made));
    if (next(40) === 0) pool[next(pool.length)] = made;
  }
  if (round % 500 === 0) console.log("round", round, sum, log.length);
  if (round % 4000 === 0) Bun.gc(true);
}
for (const o of pool) console.log(look(o));
