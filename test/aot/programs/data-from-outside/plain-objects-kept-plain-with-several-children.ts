// A parsed body holds several objects, some of them the same object under two names, and is cast to a record type. The cast looks at no field and touches no object: whether they fit or not, untyped code stores whatever it likes into them afterwards. Only a field of the wrong kind that typed code reads throws.
type Customer = { id: number; name: string; tags: string[] };
type Owner = { id: number; name: string; tags: string[]; level?: number };
type Deal = { buyer: Customer; seller: Customer; owner: Owner; note?: string };

let parsed: any;
let alias = "";
class Incoming {
  #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  json<T = any>(): Promise<T> {
    return Promise.resolve(this.#text).then((text: string) => {
      parsed = JSON.parse(text);
      if (alias === "seller is buyer") parsed.seller = parsed.buyer;
      if (alias === "owner is buyer") parsed.owner = parsed.buyer;
      return parsed;
    });
  }
}
function makeDeal(i: number): Deal {
  return { buyer: { id: i, name: "b", tags: [] }, seller: { id: i, name: "s", tags: [] }, owner: { id: i, name: "o", tags: [], level: 1 } };
}
function weigh(deal: Deal): number {
  return deal.buyer.id + deal.seller.name.length + deal.owner.tags.length + (deal.owner.level ?? 0) + (deal.note === undefined ? 0 : deal.note.length);
}
function noteLength(deal: Deal): number {
  return deal.note === undefined ? 0 : deal.note.length;
}
function attempt(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
async function cast(incoming: Incoming): Promise<string> {
  try {
    const deal = (await incoming.json()) as Deal;
    return noteLength(deal) + (deal === parsed ? " cast" : " another object");
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
async function weighBody(incoming: Incoming): Promise<string> {
  try {
    return String(weigh((await incoming.json()) as Deal));
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const person = (i: number, more = "") => '{"id":' + i + ',"name":"n' + i + '","tags":["x"]' + more + "}";
const body = (buyer: string, seller: string, owner: string, rest = "") => new Incoming('{"buyer":' + buyer + ',"seller":' + seller + ',"owner":' + owner + rest + "}");
const takesText = (below: any) => attempt(() => { below.id = "text"; return below.id; });

console.log(weigh(makeDeal(1)));
let sum = 0;
for (let i = 0; i < 500; i++) sum += Number(await weighBody(body(person(i), person(i + 1), person(i + 2, i % 2 ? ',"level":3' : ""), i % 3 ? "" : ',"note":"n"')));
console.log(sum, JSON.stringify(parsed), Object.keys(parsed.owner).join());

for (const [name, buyer, seller, owner, rest] of [
  ["all fit", person(1), person(2), person(3), ""],
  ["the last does not fit", person(1), person(2), '{"id":"x","name":"n","tags":[]}', ""],
  ["the middle one does not fit", person(1), '{"id":1,"name":2,"tags":[]}', person(3), ""],
  ["the first does not fit", '{"id":1}', person(2), person(3), ""],
  ["the note does not fit", person(1), person(2), person(3), ',"note":7'],
]) {
  const outcome = await cast(body(buyer, seller, owner, rest));
  console.log(name + ":", outcome, takesText(parsed.buyer), takesText(parsed.seller), takesText(parsed.owner));
}
for (const which of ["seller is buyer", "owner is buyer"]) {
  alias = which;
  for (let i = 0; i < 3; i++) {
    const outcome = await weighBody(body(person(4), person(5), person(6)));
    console.log(which + ":", outcome, parsed.seller === parsed.buyer, parsed.owner === parsed.buyer, takesText(parsed.buyer), takesText(parsed.seller), takesText(parsed.owner));
  }
}
