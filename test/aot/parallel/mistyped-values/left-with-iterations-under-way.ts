// Iterations whose state is handed over field by field, left in the middle of a turn: the position moves on while what the step gave is still read.
function openTheWorld(): unknown { return eval("1"); }
type Host = { a: number; s: string; log: (x: number) => void };
let seen = 0, calls = 0, breakAt = 0, how = 0;
const host: any = { a: 1, s: "s", log(x: number) { seen += x; if (++calls === breakAt) { if (how === 0) host.s = 7; else if (how === 1) host.a = "one"; else delete host.s; } } };
function fresh(at: number, kind: number) { host.a = 1; host.s = "s"; calls = 0; breakAt = at; how = kind; }
export function entries(list: number[], h: Host, p0: string, p1: number, p2: string, p3: number, p4: string, p5: number) {
  let out = "";
  for (const [i, v] of list.entries()) {
    h.log(i);
    out += i + ":" + v + h.s;
    h.log(v);
    out += "|" + i + h.a + p0 + p1;
    h.log(1);
    out += v + "/" + i + p2 + p3 + p4 + p5;
  }
  return out;
}
export function maps(map: Map<string, number>, set: Set<string>, h: Host, p0: string, p1: number, p2: string, p3: number) {
  let out = "";
  for (const [k, v] of map) {
    h.log(v);
    out += k + v + h.s;
    if (v === 2) { map.set("late" + map.size, 50); map.delete("c"); }
    h.log(1);
    for (const w of set) {
      h.log(2);
      out += w + k + h.a + p0;
      if (w === "y" && set.size < 5) set.add("n" + set.size);
      h.log(3);
      out += w + v + p1;
    }
    out += k + p2 + p3;
  }
  return out;
}
export function texts(text: string, bag: Record<string, number>, h: Host, p0: string, p1: number, p2: string, p3: number, p4: number) {
  let out = "";
  for (const ch of text) {
    h.log(1);
    out += ch + h.s;
    for (const key in bag) {
      h.log(2);
      out += key + ch + h.a + p0 + p1;
      h.log(3);
      out += key + bag[key] + p2;
    }
    h.log(4);
    out += ch + p3 + p4;
  }
  return out;
}
function* gen(n: number) { for (let i = 0; i < n; i++) yield i * 2; }
export function generators(n: number, h: Host, p0: string, p1: number, p2: string, p3: number, p4: string, p5: number) {
  let out = "";
  for (const g of gen(n)) {
    h.log(g);
    out += g + h.s + p0 + p1;
    h.log(1);
    out += g + h.a + p2 + p3 + p4 + p5;
  }
  return out;
}
openTheWorld();
Object.assign(globalThis as any, { entries, maps, texts, generators });
for (let kind = 0; kind < 3; kind++) for (let at = 0; at < 14; at++) {
  fresh(at, kind); console.log(kind, at, entries([5, 6, 7, 8], host, "P", 1.5, "Q", 2, "R", -0), seen);
  fresh(at, kind); console.log(kind, at, maps(new Map([["a", 1], ["b", 2], ["c", 3]]), new Set(["x", "y"]), host, "P", 1.5, "Q", 2), seen);
  fresh(at, kind); console.log(kind, at, texts("a\u{1F600}b", { k: 1, l: 2 }, host, "P", 1.5, "Q", 2, 3), seen);
  fresh(at, kind); console.log(kind, at, generators(4, host, "P", 1.5, "Q", 2, "R", 3), seen);
}
