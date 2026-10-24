// `Object.create(proto) as Record<string, unknown>`: an ordinary object under a known prototype: names stored under computed keys go into it alone, and the methods of the prototype are found.
const proto = {
  describe(this: Record<string, unknown>) {
    return Object.keys(this).length;
  },
};
const counters = { made: 0, read: 0 };
function make(names: string[]) {
  const record = Object.create(proto) as Record<string, unknown>;
  for (const name of names) record[name] = name.length;
  counters.made++;
  return record;
}
let total = 0;
for (let i = 0; i < 300000; i++) {
  const record = make(i & 1 ? ["a", "bb"] : ["ccc"]);
  counters.read++;
  total += (record as any).describe() + ((record.bb as number) ?? 0);
}
console.log(total, counters.made, counters.read);
