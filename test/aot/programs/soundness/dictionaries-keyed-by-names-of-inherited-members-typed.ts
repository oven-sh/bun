function attempt<T>(f: () => T): T | string { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
const words: string[] = JSON.parse('["a","constructor","a","__proto__","toString","hasOwnProperty","valueOf","__proto__","__defineGetter__","isPrototypeOf","b","length","name","prototype","push","0","then","toJSON"]');
function show(v: unknown): string { return typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : typeof v + ":" + String(v); }

// array with string keys
(() => {
  const list: any = [1, 2, 3];
  for (const w of words) console.log("array-with-string-keys", w, attempt(() => show(list[w])));
  for (const w of words) attempt(() => { list[w] = 5; });
  let s = 0; for (let i = 0; i < list.length; i++) s = s + list[i];
  console.log("array-with-string-keys", show(s), list.length, Object.keys(list).join());
})();

// cache null prototype
(() => {
  const cache: Record<string, number> = Object.create(null);
  function lookup(w: string): number { const hit = cache[w]; if (hit !== undefined) return hit; return cache[w] = w.length; }
  for (const w of words) console.log("cache-null-prototype", w, show(lookup(w)), show(lookup(w) * 2));
})();

// class static by key
(() => {
  class K { static a = 1; static m() { return 1; } }
  const k: any = K;
  for (const w of words) console.log("class-static-by-key", w, attempt(() => show(k[w])));
})();

// count in test literal
(() => {
  const counts: Record<string, number> = {};
  for (const w of words) { if (!(w in counts)) counts[w] = 0; counts[w] += 1; }
  for (const w of words) console.log("count-in-test-literal", w, show(counts[w]));
  console.log("count-in-test-literal", Object.keys(counts).join());
})();

// count in test null prototype
(() => {
  const counts: Record<string, number> = Object.create(null);
  for (const w of words) { if (!(w in counts)) counts[w] = 0; counts[w] += 1; }
  for (const w of words) console.log("count-in-test-null-prototype", w, show(counts[w]));
  console.log("count-in-test-null-prototype", Object.keys(counts).join());
})();

// count nullish assign literal
(() => {
  const counts: Record<string, number> = {};
  for (const w of words) { counts[w] ??= 0; counts[w] = counts[w] + 1; }
  let total = 0;
  for (const w of words) total = total + counts[w];
  console.log("count-nullish-assign-literal", show(total));
  console.log("count-nullish-assign-literal", Object.keys(counts).join());
})();

// count nullish assign null prototype
(() => {
  const counts: Record<string, number> = Object.create(null);
  for (const w of words) { counts[w] ??= 0; counts[w] = counts[w] + 1; }
  let total = 0;
  for (const w of words) total = total + counts[w];
  console.log("count-nullish-assign-null-prototype", show(total));
  console.log("count-nullish-assign-null-prototype", Object.keys(counts).join());
})();

// count or zero literal
(() => {
  const counts: Record<string, number> = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  for (const w of words) console.log("count-or-zero-literal", w, show(counts[w]));
  console.log("count-or-zero-literal", Object.keys(counts).join());
})();

// count or zero null prototype
(() => {
  const counts: Record<string, number> = Object.create(null);
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  for (const w of words) console.log("count-or-zero-null-prototype", w, show(counts[w]));
  console.log("count-or-zero-null-prototype", Object.keys(counts).join());
})();

// count undefined test literal
(() => {
  const counts: Record<string, number> = {};
  for (const w of words) { if (counts[w] === undefined) counts[w] = 0; counts[w]++; }
  for (const w of words) console.log("count-undefined-test-literal", w, show(counts[w]));
  console.log("count-undefined-test-literal", Object.keys(counts).join());
})();

// count undefined test null prototype
(() => {
  const counts: Record<string, number> = Object.create(null);
  for (const w of words) { if (counts[w] === undefined) counts[w] = 0; counts[w]++; }
  for (const w of words) console.log("count-undefined-test-null-prototype", w, show(counts[w]));
  console.log("count-undefined-test-null-prototype", Object.keys(counts).join());
})();

// delete by key literal
(() => {
  const set: Record<string, boolean> = {};
  for (const w of words) set[w] = true;
  for (const w of words) console.log("delete-by-key-literal", w, attempt(() => delete set[w]), show(set[w]));
  console.log("delete-by-key-literal", Object.keys(set).join());
})();

// delete by key null prototype
(() => {
  const set: Record<string, boolean> = Object.create(null);
  for (const w of words) set[w] = true;
  for (const w of words) console.log("delete-by-key-null-prototype", w, attempt(() => delete set[w]), show(set[w]));
  console.log("delete-by-key-null-prototype", Object.keys(set).join());
})();

// function as dictionary
(() => {
  const f: any = function named(x: number) { return x; };
  for (const w of words) console.log("function-as-dictionary", w, attempt(() => show(f[w])));
  for (const w of words) attempt(() => { f[w] = 5; });
  console.log("function-as-dictionary", f.length, f.name, show(f.prototype), attempt(() => f(1)), Object.keys(f).join());
})();

// functions by key literal
(() => {
  const handlers: Record<string, (x: number) => number> = {};
  handlers.a = x => x + 1; handlers.b = x => x * 2;
  for (const w of words) console.log("functions-by-key-literal", w, attempt(() => { const h = handlers[w]; return h ? show(h(3)) : "none"; }));
})();

// functions by key null prototype
(() => {
  const handlers: Record<string, (x: number) => number> = Object.create(null);
  handlers.a = x => x + 1; handlers.b = x => x * 2;
  for (const w of words) console.log("functions-by-key-null-prototype", w, attempt(() => { const h = handlers[w]; return h ? show(h(3)) : "none"; }));
})();

// group push literal
(() => {
  const groups: Record<string, number[]> = {};
  let i = 0;
  for (const w of words) console.log("group-push-literal", w, attempt(() => { (groups[w] ||= []).push(i++); return groups[w].length; }));
  console.log("group-push-literal", Object.keys(groups).join());
})();

// group push null prototype
(() => {
  const groups: Record<string, number[]> = Object.create(null);
  let i = 0;
  for (const w of words) console.log("group-push-null-prototype", w, attempt(() => { (groups[w] ||= []).push(i++); return groups[w].length; }));
  console.log("group-push-null-prototype", Object.keys(groups).join());
})();

// instance as dictionary
(() => {
  class Bag { a = 1; m() { return "Bag.m"; } }
  const bag: any = new Bag();
  for (const w of [...words, "m"]) console.log("instance-as-dictionary", w, attempt(() => show(bag[w])));
  for (const w of [...words, "m"]) attempt(() => { bag[w] = { m() { return "stored.m"; } }; });
  console.log("instance-as-dictionary", attempt(() => bag.m()), bag instanceof Bag, Object.keys(bag).join());
})();

// map control
(() => {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  let line = ""; for (const w of words) line += w + "=" + counts.get(w) + " ";
  console.log("map-control", line);
})();

// nested merge null prototype
(() => {
  function merge(d: any, s: any) { for (const k in s) { if (typeof s[k] === "object" && s[k] !== null && typeof d[k] === "object") merge(d[k], s[k]); else d[k] = s[k]; } return d; }
  const target: any = Object.create(null);
  attempt(() => merge(target, JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted2": 2}}, "a": {"b": 1}}')));
  console.log("nested-merge-null-prototype", show(target.polluted), show(({} as any).polluted), show(({} as any).polluted2), Object.keys(target).join());
})();

// number indexed by key
(() => {
  const n: any = 5;
  for (const w of words) console.log("number-indexed-by-key", w, attempt(() => show(n[w])));
})();

// objects by key null prototype
(() => {
  const table: Record<string, { n: number }> = Object.create(null);
  for (const w of words) console.log("objects-by-key-null-prototype", w, attempt(() => { const e = table[w] || (table[w] = { n: 0 }); e.n = e.n + 1; return show(e.n); }));
  console.log("objects-by-key-null-prototype", Object.keys(table).join(), show(({} as any).n), show(Object.prototype.hasOwnProperty.call(Object.prototype, "n")));
})();

// proto object stored literal
(() => {
  const table: Record<string, { n: number }> = {};
  for (const w of words) table[w] = { n: w.length };
  for (const w of [...words, "n", "zzz"]) console.log("proto-object-stored-literal", w, attempt(() => show(table[w])), attempt(() => show(table[w].n)));
  console.log("proto-object-stored-literal", Object.keys(table).join(), Object.getPrototypeOf(table) === Object.prototype, Object.getPrototypeOf(table) === null);
})();

// proto object stored null prototype
(() => {
  const table: Record<string, { n: number }> = Object.create(null);
  for (const w of words) table[w] = { n: w.length };
  for (const w of [...words, "n", "zzz"]) console.log("proto-object-stored-null-prototype", w, attempt(() => show(table[w])), attempt(() => show(table[w].n)));
  console.log("proto-object-stored-null-prototype", Object.keys(table).join(), Object.getPrototypeOf(table) === Object.prototype, Object.getPrototypeOf(table) === null);
})();

// string indexed by key
(() => {
  const s: any = "xyz";
  for (const w of words) console.log("string-indexed-by-key", w, attempt(() => show(s[w])));
})();

// strings by key literal
(() => {
  const names: Record<string, string> = {};
  names.a = "A";
  for (const w of words) console.log("strings-by-key-literal", w, attempt(() => { const s = names[w]; return s === undefined ? "none" : show(s.length) + show(s + "!"); }));
})();

// strings by key null prototype
(() => {
  const names: Record<string, string> = Object.create(null);
  names.a = "A";
  for (const w of words) console.log("strings-by-key-null-prototype", w, attempt(() => { const s = names[w]; return s === undefined ? "none" : show(s.length) + show(s + "!"); }));
})();
