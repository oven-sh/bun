// Array methods that take a callback, over arrays that are sparse, inherit elements, or stop being ordinary arrays while the callback runs.
type A = any[];
const makers: [string, () => A][] = [
  ["plain", () => [1, 2, 3, 4]],
  ["doubles", () => [1.5, 2.5, 3.5, 4.5]],
  ["objects", () => ["a", "b", "c", "d"]],
  ["holes", () => [1, , 3, , 5]],
  ["onlyHoles", () => new Array(4)],
  ["sparse", () => { const a: A = [1, 2]; a[100000] = 3; a.length = 6; a[5] = 9; return a; }],
  ["inherited", () => { const a: A = [1, , 3]; Object.setPrototypeOf(a, Object.assign(Object.create(Array.prototype), { 1: "proto" })); return a; }],
  ["empty", () => []],
];
const spoilers: [string, (a: A, k: number) => void][] = [
  ["none", () => {}],
  ["push", (a, k) => { if (k === 1) a.push("pushed"); }],
  ["shrink", (a, k) => { if (k === 1) a.length = 2; }],
  ["toObjects", (a, k) => { if (k === 0) a[2] = { o: 1 }; }],
  ["toDoubles", (a, k) => { if (k === 0) a[2] = 0.25; }],
  ["punch", (a, k) => { if (k === 0) delete a[2]; }],
  ["far", (a, k) => { if (k === 1) a[50000] = "far"; }],
];
const show = (v: unknown): string => { try { return JSON.stringify(v) ?? String(v); } catch { return "?"; } };
function each(a: A, spoil: (a: A, k: number) => void): string {
  const seen: string[] = [];
  const note = (x: unknown, k: number) => { seen.push(k + ":" + show(x)); spoil(a, k); };
  const copy = () => a.slice();
  const out: string[] = [];
  const run = (name: string, f: (b: A) => unknown) => {
    const saved = copy(); seen.length = 0;
    let r: unknown; try { r = f(a); } catch (e) { r = "threw " + (e as Error).message; }
    out.push(name + "=" + show(r) + "[" + seen.join() + "]");
    a.length = 0; for (let i = 0; i < saved.length; i++) if (i in saved) a[i] = saved[i]; a.length = saved.length;
  };
  run("forEach", b => b.forEach((x, k) => note(x, k)));
  run("map", b => b.map((x, k) => { note(x, k); return [x]; }));
  run("filter", b => b.filter((x, k) => { note(x, k); return k !== 1; }));
  run("some", b => b.some((x, k) => { note(x, k); return k === 3; }));
  run("every", b => b.every((x, k) => { note(x, k); return k !== 3; }));
  run("find", b => b.find((x, k) => { note(x, k); return k === 3; }));
  run("findLast", b => b.findLast((x, k) => { note(x, k); return k === 0; }));
  run("findIndex", b => b.findIndex((x, k) => { note(x, k); return k === 3; }));
  run("findLastIndex", b => b.findLastIndex((x, k) => { note(x, k); return k === 0; }));
  run("reduce", b => b.reduce((s, x, k) => { note(x, k); return s + "," + show(x); }, "s"));
  run("reduce0", b => b.reduce((s, x, k) => { note(x, k); return s + "," + show(x); }));
  run("reduceN", b => b.reduce((s, x, k) => { note(x, k); return typeof x === "number" ? s + x : s; }, 0));
  run("reduceRight", b => b.reduceRight((s, x, k) => { note(x, k); return s + "," + show(x); }, "s"));
  run("reduceRight0", b => b.reduceRight((s, x, k) => { note(x, k); return s + "," + show(x); }));
  run("flatMap", b => b.flatMap((x, k) => { note(x, k); return k % 2 ? [x, [k]] : x; }));
  return out.join(" ");
}
for (let round = 0; round < 3; round++) {
  for (const [m, make] of makers) for (const [s, spoil] of spoilers) {
    const line = each(make(), spoil);
    if (round === 2) console.log(m, s, line);
  }
}
function thrower(a: A): string {
  try { a.map((x, k) => { if (k === 2) throw new Error("at " + k); return x; }); return "none"; }
  catch (e) { const stack = (e as Error).stack ?? ""; return (e as Error).message + " " + (stack.indexOf("map") < stack.indexOf("thrower")); }
}
console.log(thrower([1, 2, 3]), "|", thrower([1, , 3]), "|", thrower((() => { const a: A = [1, 2, 3]; a[90000] = 1; return a; })()));
