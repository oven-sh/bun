// Functions with a rest parameter that are called through a value, by compiled code and by native code: the rest array is made from the arguments in the frame.
// Some only read it, some keep it, change it or hand it to native code. The output is that of plain Bun.
const kept = [];
const lines = [];
const box = n => ({ n });
const show = value => (Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? "{" + value.n + "}" : String(value));

const table = {
  reads(first, ...rest) {
    let seen = show(first) + ":";
    for (let i = 0; i < rest.length; i++) seen += show(rest[i]);
    return seen + rest.length + show(rest[rest.length]) + show(rest[-1]);
  },
  collects(...rest) {
    Bun.gc(true);
    const garbage = [];
    for (let i = 0; i < 1000; i++) garbage.push(box(i));
    Bun.gc(true);
    return show(rest) + garbage.length;
  },
  keeps(...rest) {
    kept.push(rest);
    return rest.length;
  },
  returns(...rest) {
    return rest;
  },
  pushes(...rest) {
    rest.push("pushed");
    return show(rest);
  },
  forwards(...rest) {
    return table.reads(...rest) + table.reads.apply(null, rest) + Reflect.apply(table.keeps, null, rest);
  },
  compares(other, ...rest) {
    return (rest === other) + "" + (rest === rest) + (rest === kept[0]);
  },
  recurses(depth, ...rest) {
    return depth > 0 ? table.recurses(depth - 1, ...rest, depth) : show(rest);
  },
  throwsIt(...rest) {
    throw rest;
  },
};

const names = Object.keys(table);
for (let round = 0; round < 3; round++) {
  for (const name of names) {
    const method = table[name];
    for (const count of [0, 1, 2, 3, 8, 9, 10, 20]) {
      const values = [];
      for (let i = 0; i < count; i++) values.push(name === "recurses" && i === 0 ? 3 : i % 2 ? "v" + i : box(i + round));
      try {
        lines.push(name + count + "=" + show(method(...values)));
      } catch (thrown) {
        thrown.push("caught");
        lines.push(name + count + "!" + show(thrown));
      }
    }
  }
  lines.push([box(round), "m"].map(table.reads).join("/"), [3, 1, 2].sort(table.keeps).join());
}
queueMicrotask(table.keeps);
await Promise.resolve(box(7)).then(table.keeps);
await new Promise(resolve => setTimeout((...rest) => resolve(table.keeps(...rest)), 0, box(8), "timer"));
Bun.gc(true);
lines.push(kept.length, new Set(kept).size, kept.map(show).join("|"));
console.log(lines.join("\n"));
