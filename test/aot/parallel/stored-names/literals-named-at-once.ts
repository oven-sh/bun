// Array literals and rest arrays that are stored into by name where they are made: room for four names, the fifth name, growth by push, copies, and what keeps them alive.
let digest = 0, cases = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const show = (a: any): string => Object.keys(a).map(k => k + "=" + (Array.isArray(a[k]) ? "[" + a[k].length + "]" : typeof a[k] === "object" && a[k] ? "{" + Object.keys(a[k]) + "}" : String(a[k]))).join(";") + "|" + a.length;
const makers: ((i: number, v: any) => any)[] = [
  i => { const a: any = [i]; a.x = i; return a; },
  i => { const a: any = [i, i + 1]; a.x = i; a.y = 2; return a; },
  i => { const a: any = [i, i + 1, i + 2]; a.x = i; a.y = 2; a.z = 3; return a; },
  i => { const a: any = [i, 1, 2, 3]; a.x = i; a.y = 2; a.z = 3; a.w = 4; return a; },
  i => { const a: any = [i | 0, 1, 2, 3]; a.x = i; a.y = 2; a.z = 3; a.w = 4; a.v = 5; return a; },
  (i, v) => { const a: any = [v, i]; a.x = v; return a; },
  (i, v) => { const a: any = [v, i, v, "t" + i]; a.x = v; a.y = [v]; a.z = { v }; a.w = i; a.v = v; a.u = i + 0.5; a.t = null; a.s = undefined; a.r = v; return a; },
  (i, v) => { const a: any = [i / 2, 0.5]; a.x = i / 2; return a; },
  (i, v) => { const a: any = [, i]; a.x = i; return a; },
  (i, v) => { const a: any = ["a", "b"]; a.raw = ["a", "b"]; return a; },
  (i, v) => { const a: any = [1, 2, 3]; a.x = v; return a; },
  (i, v) => { const a: any = [i, i, i, i, i, i]; a.x = v; a.y = i; return a; },
  (i, v) => { const a: any = []; a.x = v; a.push(i); return a; },
  (i, v) => { const a: any = [v]; a.at = i; a.push(v); return a; },
  (i, v) => { const a: any = [i, v]; if (i % 2) a.x = v; else a.y = v; return a; },
  (i, v) => { const a: any = [i, v]; a.length = 1; a.x = v; a.length = 5; a.y = i; return a; },
  (i, v) => { const a: any = [i, v]; a.x = a; a.y = [a]; return a; },
  (i, v) => ((...rest: any[]): any => { (rest as any).total = rest.length; return rest; })(i, v, 3),
  (i, v) => ((...rest: any[]): any => { (rest as any).total = rest.length; (rest as any).last = rest[0]; rest.push(v); return rest; })(i),
  (i, v) => ((...rest: any[]): any => { (rest as any).total = v; return rest; })(),
];
const changes: ((a: any, i: number) => void)[] = [
  a => { }, a => { a.push(1); }, (a, i) => { for (let k = 0; k < 20; k++) a.push(k + i); }, a => { a.push("z"); a.push(0.5); }, a => { a.unshift(7); }, a => { a.splice(0, 1); }, a => { a.reverse(); },
  a => { a.p1 = 1; a.p2 = 2; a.p3 = 3; a.p4 = 4; a.p5 = 5; a.p6 = 6; }, a => { delete a.x; a.x = "again"; }, a => { a[10] = 1; }, a => { a[2000] = 1; }, a => { Object.freeze(a); }, a => { Object.defineProperty(a, "x", { get() { return 5; }, configurable: true, enumerable: true }); },
  a => { a.sort(); }, a => { a.fill(0); }, a => { a.length = 0; a.q = 1; }, a => { a.concat([1]).q = 2; }, a => { const c = a.slice(); c.q = 3; a.copy = c; }, a => { a[0] = 0.25; a[1] = "t"; }, a => { Object.assign(a, { m: 1, n: 2, o: 3, p: 4 }); },
];
for (let round = 0; round < 6; round++) for (let m = 0; m < makers.length; m++) for (let c = 0; c < changes.length; c++) {
  const v = round % 3 === 0 ? round : round % 3 === 1 ? "v" + round : { round };
  const a = makers[m]!(round * 7 + c, v);
  try { changes[c]!(a, round); } catch (e) { add((e as Error).name); }
  add(m + "." + c + "." + show(a));
}
console.log(cases, digest);
function kept(n: number): string {
  const all: any[] = [];
  for (let i = 0; i < n; i++) {
    const a: any = [{ i }, "e" + i]; a.owner = { name: "o" + i }; a.list = [i]; a.third = "t" + i; a.fourth = { deep: [i] };
    if (i % 3 === 0) a.fifth = [i, i]; if (i % 7 === 0) a.push({ pushed: i });
    if (i % 5 === 0) all.push(a);
  }
  let sum = 0;
  for (const a of all) sum += a[0].i + a[1].length + a.owner.name.length + a.list[0] + a.third.length + a.fourth.deep[0] + (a.fifth ? a.fifth[1] : 0) + (a[2] ? a[2].pushed : 0);
  return all.length + " " + sum;
}
console.log(kept(30000));
function total(...values: number[]): number { (values as any).total = 0; for (const v of values) (values as any).total += v; return (values as any).total; }
let t = 0;
for (let i = 0; i < 2000; i++) t = (t + total(i, 1, 2) + total(i) + total(i, 2, 3, 4) + total()) % 1000003;
console.log(t);
