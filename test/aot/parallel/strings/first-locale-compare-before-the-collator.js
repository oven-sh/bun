// The first comparison of a program, before the realm has made its collator.
const a = ["foo12", "foo9", "Foo12", "foo"];
const out = [];
for (const x of a) for (const y of a) out.push(x.localeCompare(y));
console.log(out.join());
