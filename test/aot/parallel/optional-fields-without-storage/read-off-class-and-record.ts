// An optional field that no constructor fills has no storage. A read off this class and off a record without the field gives undefined.
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
try {
  values[0].name = null;
} catch {}
console.log(values.map(describe).join(" ; "));
