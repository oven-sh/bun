// What JSON.parse makes and an object without a prototype, cast to an interface
interface User {
  name: string;
  age: number;
}
function tell(u: User): string {
  return u.name + "|" + u.age + "|" + Object.keys(u).join() + "|" + (u instanceof Object) + "|" + JSON.stringify(u);
}
const made: User = { name: "made", age: 1 };
const parsed = JSON.parse('{"age":2,"name":"parsed","extra":true}') as User;
const nulled = Object.assign(Object.create(null), { name: "bare", age: 3 }) as User;
for (let round = 0; round < 3; round++) for (const u of [made, parsed, nulled]) console.log(tell(u));
