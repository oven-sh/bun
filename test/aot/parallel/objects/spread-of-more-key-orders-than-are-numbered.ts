// A layout numbers a few thousand key orders. An object with a further order is still copied at once, with its keys in order.
// COUNT: counter:CopiesCollectedByName <= 1000
// COUNT: counter:KeyOrdersStoredOutOfLine >= 900
type Seven = { a?: number; b?: number; c?: string; d?: number; e?: number; f?: number; g?: number };
type Name = keyof Seven;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
function madeIn(names: Name[], seed: number): Seven {
  const made: Seven = {};
  for (const name of names) {
    if (name === "c") made.c = "c" + seed;
    else made[name] = seed + name.charCodeAt(0);
  }
  return made;
}
function hash(text: string, into: number): number {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
const list: Seven[] = [];
for (let at = 0; at < 5040; at++) list.push(madeIn(order(at), at));

const typed = list.map((value): Seven => ({ ...value }));
const untyped = list.map((value: any) => ({ ...value }));
const behindMember = list.map((value): Seven => ({ a: -1, ...value }));
const frozen = list.map((value): Seven => ({ ...Object.freeze({ ...value }) }));

let sums = [0, 0, 0, 0, 0];
for (let at = 0; at < list.length; at++) {
  sums[0] = hash(JSON.stringify(list[at]), sums[0]);
  sums[1] = hash(JSON.stringify(typed[at]), sums[1]);
  sums[2] = hash(JSON.stringify(untyped[at]), sums[2]);
  sums[3] = hash(JSON.stringify(behindMember[at]), sums[3]);
  sums[4] = hash(Object.keys(frozen[at]).join() + Object.isFrozen(frozen[at]), sums[4]);
}
console.log(sums.join(" "), sums[0] === sums[1], sums[0] === sums[2]);

// A copy is an object of its own.
const last = list.length - 1;
typed[last].a = 7;
delete typed[last].b;
typed[last].b = 8;
untyped[last].late = 9;
delete untyped[last - 1].g;
console.log(JSON.stringify(list[last]), JSON.stringify(typed[last]), JSON.stringify(untyped[last]), JSON.stringify(list[last - 1]), JSON.stringify(untyped[last - 1]));
console.log(Object.keys(typed[4999]).join(), Object.entries(untyped[4500]).join(";"), JSON.stringify(behindMember[5000]));
