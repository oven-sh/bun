// From 65 members on the stub that appends the members of a Set cannot make room by itself and the run time appends them. Sets of 64, 65, 100 and 1,000 members: small integers, large and broken numbers, texts, objects, a mix;
// with members deleted at the front, in the middle and at the end, cleared and filled again, spread into an empty list, behind other elements, twice into one list, and while another walk of the Set stands open.
const sizes = [0, 1, 64, 65, 100, 1000];
const kinds: Record<string, (at: number) => unknown> = {
  integers: at => at, large: at => at * 1e10, broken: at => at + 0.5, texts: at => "k" + at, objects: at => ({ at }), mixed: at => (at % 4 === 0 ? at : at % 4 === 1 ? "t" + at : at % 4 === 2 ? at / 3 : { at }),
  odd: at => (at === 0 ? undefined : at === 1 ? null : at === 2 ? NaN : at === 3 ? -0 : at === 4 ? true : at === 5 ? 10n : at === 6 ? Symbol.iterator : at),
};
const show = (list: unknown[]): string => { let hash = 0, text = ""; for (const member of list) { const word = typeof member === "object" && member ? "o" + (member as any).at : String(member); for (let at = 0; at < word.length; at++) hash = (hash * 31 + word.charCodeAt(at)) | 0; if (text.length < 24) text += word + ","; } return list.length + ":" + hash + ":" + text; };
function spread(set: Set<unknown>): unknown[] { return [...set]; }
function behind(set: Set<unknown>): unknown[] { return ["first", 2, ...set, "last"]; }
function twice(set: Set<unknown>): unknown[] { return [...set, ...set]; }
function numbers(set: Set<number>): number[] { return [0.5, ...set]; }
let out = "";
for (const [name, make] of Object.entries(kinds)) for (const size of sizes) {
  const set = new Set<unknown>();
  for (let at = 0; at < size; at++) set.add(make(at));
  out += name + " " + size + " " + show(spread(set)) + " " + show(behind(set)) + " " + show(twice(set)) + "\n";
  const members = [...set];
  for (const at of [0, 1, size >> 1, size - 2, size - 1]) if (at >= 0 && at < members.length) set.delete(members[at]);
  out += " with gaps " + show(spread(set)) + " " + show(behind(set)) + "\n";
  const walk = set.values(); walk.next();
  for (let at = 0; at < 70; at++) set.add(make(size + at));
  out += " grown under a walk " + show(spread(set)) + " " + String(walk.next().done) + "\n";
  set.clear();
  out += " cleared " + show(spread(set));
  for (let at = 0; at < 66; at++) set.add(make(at));
  out += " filled again " + show(spread(set)) + "\n";
}
const counted = new Set<number>(); for (let at = 0; at < 200; at++) counted.add(at);
console.log(out + show(numbers(counted)));
