// No wrong answer is expected here: this one is to be counted. A library gives its class a default by a computed name at start, as mixins do, so the guard of that one name is broken before the first hot call.
// The hot function reads that name and three other optional fields of the same class. With a test of its own for each name, one read goes by name and three stay typed.
// With one test for the names of the function, all four go by name for the life of the program. Count the failing edges of AreMembersUnchanged and the reads by name with and without --aot-disable=CleanReturns.
class Card {
  id: number;
  declare kind?: string;
  declare title?: string;
  declare owner?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

const defaults: Record<string, unknown> = { kind: "card" };
for (const name of Object.keys(defaults)) (Card.prototype as any)[name] = defaults[name];

function lengthOf(text: string | undefined): number {
  return text === undefined ? 1 : text.length;
}

function weigh(p: Card): number {
  return lengthOf(p.kind) + lengthOf(p.title) * 3 + lengthOf(p.owner) * 5 + lengthOf(p.note) * 7 + p.id;
}

let sum = 0;
for (let round = 0; round < 2_000_000; round++) {
  const p = new Card(round & 15);
  if ((round & 7) === 0) p.title = "title";
  if ((round & 31) === 0) p.kind = "special";
  sum = (sum + weigh(p)) | 0;
}
console.log("sum " + sum);
