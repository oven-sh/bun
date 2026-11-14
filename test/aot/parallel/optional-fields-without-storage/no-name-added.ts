// The record keeps its names. No class gains a name, and the field lies in the object.
class Person {
  nickname?: number;
}
function describe(value: any): string {
  return [value.next, value.nickname].join(",");
}
function build(): any[] {
  const values: any[] = [];
  for (let i = 0; i < 4; i++) values.push(new Person());
  return values;
}
const values = build();
values[0] = { name: 2 };
console.log(values.map(describe).join(" ; "));
