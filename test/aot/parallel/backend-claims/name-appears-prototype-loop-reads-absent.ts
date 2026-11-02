// A name appears on the prototype while a loop reads an absent field.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

function lengthOf(text: string | undefined): number {
  return text === undefined ? 1 : text.length;
}

function put(name: string, depth: number): void {
  if (depth > 0) return put(name, depth - 1);
  (Card.prototype as any)[name] = "noted";
}

const turns = process.argv.length > 99 ? 5 : 4;

function walk(card: Card, names: string[]): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    sum = sum * 10 + lengthOf(card.note);
    put(names[turn], 2);
  }
  return sum;
}

console.log(walk(new Card(1), ["other", "another", "note", "last"]));
console.log(walk(new Card(2), ["other", "another", "note", "last"]));
