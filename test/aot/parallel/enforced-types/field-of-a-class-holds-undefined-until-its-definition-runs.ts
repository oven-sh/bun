// COUNTER: FieldsEvictedByTypeMismatch >= 1
// COUNTER: FieldsEvictedByTypeMismatch <= 8
// A field of a class is defined as undefined in front of the body of its constructor, an optional member is given undefined or left out, and `null` stands where a reference is written. None of that takes a field out of its slot:
// every held type lets the two lie there. The one text at the end does, which shows that the slots are held at all. This morning's trial left the two out: 28,044 of 28,694 fields that left their slots held `undefined`.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Circle {
  area: number;
  round: boolean;
  label: string;
  next: Circle | undefined;
  skipped?: number;
  constructor(area: number, next: Circle | undefined) {
    this.area = area;
    this.round = area % 2 === 0;
    this.label = "c" + area;
    this.next = next;
  }
}
function total(list: Circle[]): string {
  let sum = 0;
  let rounds = 0;
  let skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const circle = list[i];
    sum += circle.area + circle.label.length + (circle.next ? circle.next.area : 0);
    if (circle.round) rounds++;
    if (circle.skipped === undefined) skipped++;
  }
  return sum + " " + rounds + " " + skipped;
}
const made: Circle[] = [];
for (let turn = 0; turn < 300; turn++) {
  const circle = new Circle(turn, turn % 4 ? made[turn - 1] : undefined);
  if (turn % 3 === 0) circle.skipped = undefined;
  if (turn % 5 === 0) circle.skipped = turn;
  if (turn % 7 === 0) (circle as any).next = null;
  if (turn % 11 === 0) (circle as any).area = undefined;
  if (turn % 11 === 0) circle.area = turn;
  made.push(circle);
}
console.log(total(made));
(made[5] as any).round = JSON.parse('"text"');
console.log(total(made), typeof made[5].round, Object.keys(made[5]).join());
