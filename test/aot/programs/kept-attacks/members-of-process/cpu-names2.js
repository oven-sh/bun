// Members of process: cpu names2. It prints what plain Bun prints.
function nameOf(f) { return f.name; }
function lengthOf(f) { return f.length; }
const makers = [() => () => 1, () => function named(a, b) {}, () => async () => {}];
const which = Number(process.argv[2] ?? 0);
const mode = process.argv[3] ?? "name";
let total = 0;
for (let i = 0; i < 1000; i++) {
  const f = makers[which]();
  if (mode === "name") total += nameOf(f).length;
  else if (mode === "length") total += lengthOf(f);
  else if (mode === "name-length") total += nameOf(f).length + lengthOf(f);
  else if (mode === "length-name") total += lengthOf(f) + nameOf(f).length;
  else if (mode === "name-name") total += nameOf(f).length + nameOf(f).length;
}
console.log(which, mode, total);
