// A loop that goes on behind a guess that fails, with more live values than registers take: values that change places, names of older turns, values read behind a later guess.
function openTheWorld(): unknown { return eval("1"); }
type Host = { a: number; s: string; log: (x: number) => void };
let seen = 0;
function make(kind: number): Host {
  const host: any = { a: 1, s: "s", log: (x: number) => { seen += x; } };
  if (kind === 1) host.a = "one";
  if (kind === 2) host.s = 7;
  if (kind === 3) delete host.a;
  if (kind === 4) delete host.s;
  if (kind === 5) host.log = function (x: any) { seen += 1000; };
  return host;
}
export function turns(hosts: Host[], n: number, p0: string, p1: string, p2: number, p3: number, p4: string, p5: number) {
  let older = "o", prev = "p", cur = "c";
  let x = 1, y = 2, z = 3.5;
  let out = "";
  for (let i = 0; i < n; i++) {
    const h = hosts[i % hosts.length];
    h.log(i);
    const t = cur;
    older = prev; prev = cur; cur = cur + h.s;
    const sx = x; x = y; y = sx + h.a;
    h.log(y);
    z += h.a;
    out += t + "," + older + "," + prev + "," + x + "," + y + "," + z + ";";
    h.log(i + 1);
    out += p0 + p1 + p2 + p3 + p4 + p5 + sx + t;
  }
  return out + cur + older + prev + x + y + z;
}
export function nested(hosts: Host[], n: number, p0: string, p1: number, p2: string, p3: number) {
  let a = "a", b = "b", c = 0.25, d = 1, out = "";
  for (let i = 0; i < n; i++) {
    const outer = hosts[i % hosts.length];
    outer.log(i);
    const keep = a + i;
    for (let j = 0; j < 3; j++) {
      const h = hosts[(i + j) % hosts.length];
      h.log(j);
      const swap = a; a = b; b = swap + h.s;
      c += h.a; d = (d + h.a) | 0;
      h.log(d);
      out += swap + keep + c + d + p0 + p1;
    }
    outer.log(d);
    out += keep + a + b + p2 + p3 + outer.s;
  }
  return out;
}
openTheWorld();
(globalThis as any).turns = turns; (globalThis as any).nested = nested;
for (let bad = 0; bad < 6; bad++) for (let at = 0; at < 4; at++) {
  const hosts = [make(0), make(0), make(0), make(0)];
  hosts[at] = make(bad);
  console.log(bad, at, turns(hosts, 7, "P", "Q", 2, 3.5, "R", -0), seen);
  console.log(bad, at, nested(hosts, 5, "P", 1.5, "Q", 9), seen);
}
