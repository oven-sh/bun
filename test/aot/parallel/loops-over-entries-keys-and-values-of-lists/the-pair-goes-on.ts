const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
const kept: [number, string][] = [];
for (let turn = 0; turn < 300; turn++) { said.length = 0; kept.length = 0;
  const list = ["a", "b", "c"];
  for (const pair of list.entries()) { kept.push(pair); pair[1] = pair[1] + "!"; said.push(pair.length, Array.isArray(pair)); }
  said.push(kept, list, kept[0] === kept[1]);
  for (const [i, x = "none", more = "no third"] of [undefined, "y"].entries() as IterableIterator<[number, string | undefined, string?]>) said.push(i, x, more);
  for (const [, x] of list.entries()) said.push(x); for (const [i] of list.entries()) said.push(i); for (const [...all] of list.entries()) said.push(all);
  for (const { 0: i, 1: x, length } of list.entries()) said.push(i, x, length);
}
console.log(said.map(show).join(" "));
