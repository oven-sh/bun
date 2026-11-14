// The same read in a loop.
class Person {
  nickname?: number;
}
function describe(values: any[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) text += [values[i].next, values[i].nickname].join(",") + ";";
  return text;
}
function build(): any[] {
  const values: any[] = [];
  for (let i = 0; i < 4; i++) values.push(new Person());
  return values;
}
const values = build();
values[0] = { name: 2 };
try {
  values[0].name = null;
} catch {}
console.log(describe(values));
