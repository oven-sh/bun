// Two classes have one field each, of one name, at one place and in one form, so the table of fields says the same of both. One field is written to hold a text, the other an object of a class.
// A store by name through a receiver that is written `any` remembers which kinds of values a field has taken. A text that the one field took is no object for the other.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Bar { q: string = "bar-q"; r: number = 7; }
class HoldsText { x: string = "first"; }
class HoldsBar { x: Bar = new Bar(); }
const unseen = (0, eval)("(x) => x");
function put(holder: any, value: any): void { holder.x = value; }
function lengthOf(holder: HoldsText): number { return holder.x.length; }
function readQ(holder: HoldsBar): string { return holder.x.q; }
function readR(holder: HoldsBar): number { return holder.x.r; }
const tally = new Map<string, number>();
function say(row: string): void { tally.set(row, (tally.get(row) ?? 0) + 1); }
for (let turn = 0; turn < 300; turn++) {
  const holdsText = unseen(new HoldsText());
  const holdsBar = unseen(new HoldsBar());
  const bar = unseen(new Bar());
  put(holdsText, "a text");
  put(holdsBar, "a text");
  say(`a text: ${lengthOf(holdsText)} ${readQ(holdsBar)} ${readR(holdsBar)} ${typeof holdsBar.x}`);
  put(holdsBar, bar);
  put(holdsText, bar);
  say(`a Bar: ${lengthOf(holdsText)} ${readQ(holdsBar)} ${readR(holdsBar)} ${typeof holdsText.x}`);
}
for (const [row, count] of tally) console.log(count, row);
