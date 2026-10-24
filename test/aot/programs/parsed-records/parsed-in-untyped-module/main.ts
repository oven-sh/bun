import { cached, decode, decodeLater, leak } from "./decode.js";
interface Address { city: string; zip: string }
interface Person { name: string; age: number; address: Address; previous: Address[] }
function summary(person: Person): string {
  return `${person.name} (${person.age}) ${person.address.city} ${person.address.zip} ${person.previous.map(address => address.city).join("+")}`;
}
leak({ name: "", age: 0, address: { city: "", zip: "" }, previous: [] } satisfies Person);
console.log(summary({ name: "a", age: 1, address: { city: "c", zip: "z" }, previous: [] }));
const text = '{"name":"Ann","age":41,"address":{"city":"Oslo","zip":"0150"},"previous":[{"city":"Lisbon","zip":"1000"},{"zip":"80202","city":"Denver"}]}';
for (let round = 0; round < 3; round++) {
  console.log(summary(decode(text) as Person));
  console.log(summary((await decodeLater(text)) as Person));
  const holder = { body: undefined as unknown };
  holder.body = decode(text);
  console.log(summary(holder.body as Person));
  console.log(cached(text) === cached(text), summary(cached(text) as Person));
}
