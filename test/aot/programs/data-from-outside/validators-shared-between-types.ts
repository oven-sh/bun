// The parser of a type is emitted once per file, however many of the types given to JSON.parse<T>() mention it.
// IR+ JSONStartsWith v\d+ text="\\x22street\\x22:"
// IR- JSONStartsWith v\d+ text="\\x22street\\x22:"[\s\S]*JSONStartsWith v\d+ text="\\x22street\\x22:"
// IR+ JSONStartsWith v\d+ text="\\x22zip\\x22:"
// IR- JSONStartsWith v\d+ text="\\x22zip\\x22:"[\s\S]*JSONStartsWith v\d+ text="\\x22zip\\x22:"
import { JSON } from "bun"; interface Address { street: string; zip: string }
interface Named { name: string; nickname?: string }
interface Person { who: Named; home: Address }
interface Company { title: string; office: Address; branches: Address[]; owner: Named }
function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}
const address = { street: "s", zip: "z" };
const person = { who: { name: "n", nickname: "k" }, home: address };
const company = { title: "t", office: address, branches: [address, { street: "s2", zip: "z2" }], owner: { name: "o" } };
const badNickname = { who: { name: "n", nickname: 1 }, home: address };
const badBranch = { ...company, branches: [address, { street: "s2" }] };
for (const value of [person, company, badNickname, badBranch, address]) {
  const text = JSON.stringify(value);
  console.log(describe(() => JSON.parse<Person>(text)));
  console.log(describe(() => JSON.parse<Company>(text)));
  console.log(describe(() => JSON.parse<Address>(text)), "|", describe(() => JSON.parse<Address[]>("[" + text + "]")));
}
