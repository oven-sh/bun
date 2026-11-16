// Two optional fields that no constructor fills.
class Person {
  nickname?: number;
  title?: string;
  age = 3;
}
function describe(value: any): string {
  return [value.next, value.nickname, value.title, value.age].join(",");
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
