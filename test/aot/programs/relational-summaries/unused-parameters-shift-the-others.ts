// Passes take unused parameters, unused results, `this` and captures away from a function, and make versions of it with other lists of parameters. An answer about "parameter 2" that is asked with the number of another list is an answer about another parameter. In each function here one parameter is kept, one is returned, one is stored into, one is only read, and the unused ones stand at every place between.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface T {
  tag: string;
  slot: T | null;
}
const t = (tag: string): T => ({ tag, slot: null });
const kept: T[] = [];
const rare = (x: T) => x.tag.endsWith("9");
function a1(unused: T, keep: T, back: T, into: T, value: T, read: T): T {
  if (rare(keep)) kept.push(keep);
  into.slot = value;
  return read.tag === "never" ? read : back;
}
function a2(keep: T, unused: T, back: T, into: T, value: T, read: T): T {
  if (rare(keep)) kept.push(keep);
  into.slot = value;
  return read.tag === "never" ? read : back;
}
function a3(keep: T, back: T, unused1: T, unused2: T, into: T, value: T, read: T): T {
  if (rare(keep)) kept.push(keep);
  into.slot = value;
  return read.tag === "never" ? read : back;
}
function a4(read: T, unused1: T, value: T, unused2: T, into: T, unused3: T, back: T, unused4: T, keep: T): T {
  if (rare(keep)) kept.push(keep);
  into.slot = value;
  return read.tag === "never" ? read : back;
}
function a5(unused1: T, unused2: T, unused3: T, keep: T): void {
  if (rare(keep)) kept.push(keep);
}
function a6(read: T, unused: T, keep: T): number {
  if (rare(keep)) kept.push(keep);
  return read.tag.length;
}
function a7(keep: T, unused: T, read: T): number {
  if (rare(keep)) kept.push(keep);
  return read.tag.length;
}
class Host {
  tag = "host";
  // `this` is not used.
  m1(unused: T, keep: T, read: T): number {
    if (rare(keep)) kept.push(keep);
    return read.tag.length;
  }
  // `this` is used, the first parameter is not.
  m2(unused: T, keep: T, read: T): number {
    if (rare(keep)) kept.push(keep);
    return read.tag.length + this.tag.length;
  }
  static s1(unused: T, read: T, keep: T): number {
    if (rare(keep)) kept.push(keep);
    return read.tag.length;
  }
}
function makeClosures(capturedUnused: T, capturedKept: T, capturedRead: T) {
  return {
    // Captures stand in front of the parameters.
    c1: (unused: T, keep: T, read: T): number => {
      if (rare(keep)) kept.push(keep);
      return read.tag.length + capturedRead.tag.length;
    },
    c2: (read: T): number => {
      if (rare(capturedKept)) kept.push(capturedKept);
      return read.tag.length;
    },
    c3: (): string => capturedUnused.tag,
  };
}
// The result is not used by some callers and used by others.
function r1(back: T, keep: T): T {
  if (rare(keep)) kept.push(keep);
  return back;
}
// Two results in one object; one caller reads the first, another the second.
function r2(first: T, unused: T, second: T): { first: T; second: T } {
  return { first, second };
}
// Optional and default parameters, a rest behind unused ones.
function o1(unused?: T, keep: T = t("default kept 9"), read?: T): number {
  if (rare(keep)) kept.push(keep);
  return read ? read.tag.length : 0;
}
function o2(unused1: T, unused2: T, ...rest: T[]): number {
  if (rest.length > 1 && rare(rest[1])) kept.push(rest[1]);
  return rest.length;
}
const host = new Host();
let sum = 0;
let line = "";
for (let i = 0; i < 100; i++) {
  const n = (name: string) => t(name + " " + i);
  const backs = [n("b1"), n("b2"), n("b3"), n("b4")];
  const intos = [n("i1"), n("i2"), n("i3"), n("i4")];
  const answers = [
    a1(n("u"), n("a1 kept"), backs[0], intos[0], n("a1 value"), n("r")),
    a2(n("a2 kept"), n("u"), backs[1], intos[1], n("a2 value"), n("r")),
    a3(n("a3 kept"), backs[2], n("u"), n("u"), intos[2], n("a3 value"), n("r")),
    a4(n("r"), n("u"), n("a4 value"), n("u"), intos[3], n("u"), backs[3], n("u"), n("a4 kept")),
  ];
  a5(n("u"), n("u"), n("u"), n("a5 kept"));
  sum += a6(n("r"), n("u"), n("a6 kept")) + a7(n("a7 kept"), n("u"), n("r"));
  sum += host.m1(n("u"), n("m1 kept"), n("r")) + host.m2(n("u"), n("m2 kept"), n("r")) + Host.s1(n("u"), n("r"), n("s1 kept"));
  const closures = makeClosures(n("cu"), n("c2 captured and kept"), n("cr"));
  sum += closures.c1(n("u"), n("c1 kept"), n("r")) + closures.c2(n("r")) + closures.c3().length;
  r1(n("not used"), n("r1 kept (result unused)"));
  const back = n("r1 back");
  const used = r1(back, n("r1 kept (result used)"));
  const f = n("first");
  const s = n("second");
  sum += o1(n("u"), n("o1 kept"), n("r")) + o1() + o1(undefined, undefined, n("r")) + o2(n("u"), n("u"), n("r"), n("o2 kept")) + o2(n("u"), n("u"));
  line = [answers.every((x, k) => x === backs[k]), intos.map(x => x.slot!.tag).join("+"), used === back, r2(f, n("u"), s).first === f, r2(f, n("u"), s).second === s].join();
}
console.log(sum, line, churn(60));
const byName = new Map<string, number>();
for (const k of kept) {
  const name = k.tag.replace(/ \d+$/, "");
  byName.set(name, (byName.get(name) ?? 0) + 1);
}
console.log([...byName].map(([name, count]) => name + ": " + count).join(" | "));
console.log(kept.filter(k => k.tag.endsWith(" 99")).map(k => k.tag).join(" | "));
