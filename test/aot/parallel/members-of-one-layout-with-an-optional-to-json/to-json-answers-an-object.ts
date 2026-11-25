type Entry = { name: string; toJSON?: () => unknown };
function entry(name: string, custom: boolean): Entry {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (custom) return { name, toJSON: () => ({ hidden: name.length + work }) };
  return { name };
}
function write(make: () => unknown): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + " " + String(JSON.stringify(make()));
}
console.log(write(() => ({ first: entry("a", false), second: entry("b", true) })));
