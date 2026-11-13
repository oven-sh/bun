// Texts taken apart by destructuring, with holes, defaults, rests, nesting, assignments and parameters, of every width.
const texts: string[] = ["", "a", "ab", "abc", "é日", "日本語", "😀x", "\ud83d", "\ud83dx", "x\ude00", "a😀b😀", "ÿ", ("x日本y").slice(1, 3), ("xaby").slice(1, 3), "q".repeat(50), "日".repeat(50), "a" + String(texts0()).slice(1)];
function texts0(): string { return "cdef"; }
let digest = 0;
const add = (...list: unknown[]) => { const t = JSON.stringify(list); for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const first = ([a]: string) => a;
const two = ([a = "none", b = "none"]: string) => a + b;
const third = ([, , c]: string) => c;
const rest = ([a, ...more]: string) => [a, more.length, more[0]];
let x: string | undefined, y: string | undefined; const o: any = {};
for (let round = 0; round < 3; round++) {
  for (const s of texts) {
    const [a, b, c] = s; add(a, b, c);
    const [, d, , e = "e"] = s; add(d, e);
    const [f, ...g] = s; add(f, g);
    const [] = s; const [...all] = s; add(all);
    const [{ length } = "z"] = s; add(length);
    [x, y] = s; add(x, y); [o.p, o["q"]] = s; add(o);
    [x = "dx", [y] = "dy"] = s as any; add(x, y);
    add(first(s), two(s), third(s), rest(s));
    for (const [h, i] of [s, s + "t"]) add(h, i);
    try { const [k = (() => { throw new Error("no " + s.length); })()] = s; add(k); } catch (error: any) { add(error.message); }
    const pair = s.split("a"); const [l, m] = pair; add(l, m);
    if (a !== undefined) { const t = a.toUpperCase() + s.slice(a.length); add(t, a.length, a.charCodeAt(0), a === "日", a === "a"); }
  }
  console.log(round, digest);
}
for (const bad of [null, undefined, 1, {}] as any[]) { try { const [a] = bad; console.log(a); } catch (error: any) { console.log(error.constructor.name); } }
const objects: any[] = [new String("日x"), Object("ab"), ["l", "m"], new Set("pq"), new Map([["k", 1]])];
for (const v of objects) { const [a, b] = v; console.log(JSON.stringify([a, b])); }
