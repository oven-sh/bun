type Entry = { name: string; toJSON?: () => string };
function entry(name: string, custom: boolean): Entry {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (custom) return { name, toJSON: () => "custom " + name + work };
  return { name };
}
function write(make: () => unknown): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + " " + String(JSON.stringify(make()));
}
const text = write(() => Array.from({ length: 400 }, (_, i) => ({ id: i, owner: entry("n" + i, i % 7 === 3) })));
console.log(text.length, text.split("custom").length - 1, text.slice(0, 120));
