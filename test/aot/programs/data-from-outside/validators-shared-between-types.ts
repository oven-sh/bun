// The validator and the parser of a type are emitted once per file, however many validated types mention it, and Bun.parse shares a validator with Bun.validate where nothing below it is optional.
// IR= 1 validate object = GetById v\d+ "street"
// IR= 1 validate String ",\\x22zip\\x22:\\x22"
interface Address { street: string; zip: string }
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
  console.log(describe(() => Bun.validate<Person>(value)), "|", describe(() => Bun.parse<Person>(text)));
  console.log(describe(() => Bun.validate<Company>(value)), "|", describe(() => Bun.parse<Company>(text)));
  console.log(describe(() => Bun.validate<Address>(value)), "|", describe(() => Bun.parse<Address>(text)), "|", describe(() => Bun.parse<Address[]>("[" + text + "]")));
}
