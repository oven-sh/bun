// A typed function stores into the fields of its parameter and adds an optional one. Its caller has read the object. A call in between freezes, seals, or closes the object, or makes a field read-only.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let mode = 0;
function touch(card: Card): void {
  if (mode === 1) Object.freeze(card);
  else if (mode === 2) Object.seal(card);
  else if (mode === 3) Object.preventExtensions(card);
  else if (mode === 4) Object.defineProperty(card, "id", { writable: false });
}

function stamp(card: Card): string {
  let text = "";
  try {
    card.id = -1;
    text += "id ";
  } catch (error) {
    text += (error as Error).name + " ";
  }
  try {
    card.note = "stamped";
    text += "note";
  } catch (error) {
    text += (error as Error).name;
  }
  return text;
}

function holder(card: Card): string {
  const before = card.id;
  touch(card);
  return before + " " + stamp(card) + " " + card.id + "," + card.note;
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Card(round));
  if (mode || round === 0) console.log(round + ": " + line);
}
