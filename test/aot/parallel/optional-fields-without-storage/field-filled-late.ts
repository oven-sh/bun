// One object has the field filled after its construction.
class Person {
  nickname?: string;
  fill() {
    this.nickname = "late";
  }
}
function describe(value: any): string {
  return [value.next, value.nickname].join(",");
}
const persons: Person[] = [];
function build(): any[] {
  const values: any[] = [];
  for (let i = 0; i < 4; i++) {
    const person = new Person();
    persons.push(person);
    values.push(person);
  }
  return values;
}
const values = build();
values[0] = { name: 2 };
try {
  values[0].name = null;
} catch {}
persons[2]!.fill();
console.log(values.map(describe).join(" ; "));
