// `delete` empties the slot of a declared field, optional or required; the next store creates the property anew, behind everything that exists by then.
// The field is deleted by typed code, through `any`, by Reflect.deleteProperty and under a computed key, once and many times, and undefined is stored, which is not a delete.
class Card {
  declare suit: string;
  declare rank?: number;
  declare note?: string;
  declare up?: boolean;
  constructor(suit: string) {
    this.suit = suit;
  }
}
function setRank(card: Card, value: number | undefined) {
  card.rank = value;
}
function setNote(card: Card, value: string) {
  card.note = value;
}
function setUp(card: Card, value: boolean) {
  card.up = value;
}
function dropRank(card: Card) {
  return delete card.rank;
}
function show(card: Card) {
  const names: string[] = [];
  for (const name in card) names.push(name);
  return `${Object.keys(card)} ${names.join() === Object.keys(card).join()} ${JSON.stringify(card)} ${card.rank} ${"rank" in card}`;
}
function full() {
  const card = new Card("hearts");
  setRank(card, 1);
  setNote(card, "n");
  setUp(card, true);
  return card;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const card = full();
  if (i & 1) dropRank(card);
  if (i & 2) setRank(card, 2);
  length += Object.keys(card).join().length;
}
console.log("warm", length);

const ways: [string, (card: Card) => unknown][] = [
  ["typed code", dropRank],
  ["through any", card => delete (card as any).rank],
  ["Reflect.deleteProperty", card => Reflect.deleteProperty(card, "rank")],
  ["a computed key", card => delete (card as any)[["ra", "nk"].join("")]],
];
for (const [label, drop] of ways) {
  const card = full();
  const answer = drop(card);
  const gone = show(card);
  setRank(card, 5);
  console.log(`${label}: ${answer} | ${gone} | ${show(card)}`);
}
const card = full();
setRank(card, undefined);
console.log("undefined is stored:", show(card), Object.hasOwn(card, "rank"));
dropRank(card);
console.log("deleted:", show(card), dropRank(card), show(card));
delete (card as any).suit;
setRank(card, 7);
card.suit = "spades";
console.log("the required field too:", show(card));
for (let i = 0; i < 1000; i++) {
  dropRank(card);
  if (i % 3 === 0) delete card.note;
  setRank(card, i);
  if (i % 3 === 0) setNote(card, "n" + i);
}
console.log("a thousand times:", show(card));
delete card.up;
delete card.note;
delete card.rank;
delete (card as any).suit;
console.log("everything deleted:", show(card), Object.keys(card).length);
setUp(card, false);
setNote(card, "z");
card.suit = "clubs";
setRank(card, 9);
console.log("filled backwards:", show(card));
