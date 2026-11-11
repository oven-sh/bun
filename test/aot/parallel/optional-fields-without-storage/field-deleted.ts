// One object loses the field and another gains a name.
class Person {
  nickname?: number;
}
function describe(value: any): string {
  return [value.next, value.nickname, "nickname" in value, Object.keys(value)].join(",");
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
  values[1].name = 5;
} catch {}
delete values[2].nickname;
console.log(values.map(describe).join(" ; "));
