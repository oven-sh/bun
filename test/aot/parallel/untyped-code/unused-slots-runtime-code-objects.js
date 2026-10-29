// ENV JSC_useDollarVM=1
// An object has room in itself for more properties than it holds. The collector expects the room that is not in use to be empty: it may look at a slot between the moment an object gets
// the shape with one property more and the moment the value is stored. No program can see those slots, so the engine is asked: $vm.unusedInlineStorageIsEmpty(object);
// an engine that cannot be asked is taken at its word.
// The memory is made dirty first: objects of the same sizes, full of values, are made and dropped. Then functions made at run time make objects and add properties to them,
// in their first calls and when they have been called very often. Each text is put together while the program runs: a text that stands in the program whole is compiled with it.
// Env: JSC_useDollarVM=1
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const isPlainObject = value => typeof value === "object" && value !== null;
const isClean = typeof $vm === "object" && $vm.unusedInlineStorageIsEmpty ? object => $vm.unusedInlineStorageIsEmpty(object) : object => (isPlainObject(object) ? true : undefined);
const names = Array.from({ length: 24 }, (_, i) => "k" + i);
const literalOf = size => "{ " + names.slice(0, size).map(name => name + ": v").join(", ") + " }";
const sizes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24];
const dirty = () => {
  const full = sizes.map(size => new Function("v", "return " + literalOf(size) + ";"));
  const grown = new Function("v", "const o = {}; " + names.map(name => "o." + name + " = v;").join(" ") + " return o;");
  let kept = [];
  for (let turn = 0; turn < 20000; turn++) {
    const value = { turn };
    for (const make of full) kept.push(make(value));
    kept.push(grown(value));
    if (kept.length > 50000) kept = [];
  }
  kept = [];
  collect();
};
lines.push("the engine answers: " + isClean(new Function("return " + literalOf(0) + ";")()) + " " + isClean(new Function("v", "return " + literalOf(1) + ";")(1)) + " " + isClean(1) + " " + isClean("text") + " " + isClean(null));
for (const calls of [40, 4000]) {
  dirty();
  const dirtyOnes = [];
  for (const size of sizes) {
    const make = new Function("v", "return " + literalOf(size) + ";");
    let bad = 0;
    for (let turn = 0; turn < calls; turn++) if (!isClean(make(turn + 1))) bad++;
    if (bad) dirtyOnes.push("a literal of " + size + ": " + bad);
  }
  for (const more of [1, 2, 3, 5, 6, 7, 9, 14]) {
    const steps = names.slice(0, more).map(name => new Function("o", "v", "o." + name + " = v; return o;"));
    const make = new Function("return {};");
    let bad = 0;
    for (let turn = 0; turn < calls; turn++) {
      const object = make();
      if (!isClean(object)) bad++;
      for (const step of steps) if (!isClean(step(object, turn + 1))) bad++;
    }
    if (bad) dirtyOnes.push("an empty object and " + more + " stores: " + bad);
  }
  const [a, b, c, d, e, f] = names;
  const mixed = new Function("v", `const o = { ${a}: v, ${b}: v }; if (v & 1) o.${c} = v; else o.${d} = v; o.${e} = v; delete o.${a}; o.${f} = v; return o;`);
  let bad = 0;
  for (let turn = 0; turn < calls; turn++) if (!isClean(mixed(turn + 1))) bad++;
  if (bad) dirtyOnes.push("stores and a delete: " + bad);
  lines.push(calls + " calls each: " + (dirtyOnes.length ? dirtyOnes.join("; ") : "every unused slot is empty"));
}
console.log(lines.join("\n"));
