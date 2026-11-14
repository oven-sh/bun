// Members written in more orders than a layout numbers: a spread of such an object calls nothing, whether its result has the declared type or none.
// COUNT: counter:KeyOrdersStoredOutOfLine >= 7000
// COUNT: operation:operationAOTCopyDataProperties <= 1500
// COUNT: operation:operationAOTCopyObject <= 1500
type Inline = { a: number; b: string; c: number; d: number; e: number; f: number; g: number; h: number };
type Eight = { a?: number; b?: string; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number };
type Name = keyof Eight;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
function madeIn(names: Name[], seed: number): Eight {
  const made: Eight = {};
  for (const name of names) {
    if (name === "b") made.b = "b" + seed;
    else made[name] = seed + name.charCodeAt(0);
  }
  return made;
}
function hash(text: string, into: number): number {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
function sumOf(list: object[]): number {
  let sum = 0;
  for (const value of list) sum = hash(JSON.stringify(value), sum);
  return sum;
}

const count = 12000;
const list: Eight[] = [];
for (let at = 0; at < count; at++) list.push(madeIn(order(at * 3), at));

const typed = list.map((value): Eight => ({ ...value }));
const untyped = list.map((value: any) => ({ ...value }));
const again = typed.map((value): Eight => ({ ...value }));
const untypedAgain = untyped.map((value: any) => ({ ...value }));
console.log(sumOf(list), sumOf(typed), sumOf(untyped), sumOf(again), sumOf(untypedAgain));

// A copy is an object of its own, and so is its order.
const last = count - 1;
delete typed[last].c;
typed[last].c = -1;
untyped[last].late = 9;
delete untyped[last - 1].h;
again[last].a = 7;
console.log(JSON.stringify([list[last], typed[last], untyped[last], again[last], untypedAgain[last], list[last - 1], untyped[last - 1]]));
console.log(Object.keys(typed[last - 2]).join(), Object.entries(untyped[last - 3]).join(";"), Reflect.ownKeys(again[last - 4]).join());

// What a copy does not take along.
const frozen = Object.freeze({ ...list[last - 5] });
const ofFrozen: Eight = { ...frozen };
const ofFrozenUntyped = { ...(frozen as any) };
ofFrozen.a = 1;
ofFrozenUntyped.a = 2;
console.log(Object.isFrozen(frozen), Object.isFrozen(ofFrozen), Object.isFrozen(ofFrozenUntyped), JSON.stringify([frozen, ofFrozen, ofFrozenUntyped]));

const above = { inherited: 1 };
const below: Eight = { ...list[last - 6] };
Object.setPrototypeOf(below, above);
const ofBelow: Eight = { ...below };
const ofBelowUntyped = { ...(below as any) };
console.log(Object.getPrototypeOf(ofBelow) === Object.prototype, Object.getPrototypeOf(ofBelowUntyped) === Object.prototype, "inherited" in ofBelow, "inherited" in ofBelowUntyped, JSON.stringify([ofBelow, ofBelowUntyped]));

const isAbove: Eight = { ...list[last - 7] };
const inheritor = Object.create(isAbove);
const ofAbove: Eight = { ...isAbove };
ofAbove.d = -4;
console.log(inheritor.d, JSON.stringify([isAbove, ofAbove, { ...(isAbove as any) }]));

// A name of no member between two members.
const mixed: Eight = {};
for (const name of order((last - 8) * 3).slice(0, 4)) if (name !== "b") mixed[name] = 1;
(mixed as any).between = 2;
for (const name of order((last - 8) * 3).slice(4)) if (name !== "b") mixed[name] = 3;
const ofMixed: Eight = { ...mixed };
const ofMixedUntyped = { ...(mixed as any) };
(mixed as any).behind = 4;
console.log(JSON.stringify([mixed, ofMixed, ofMixedUntyped]));

// Onto members that are there, and two at once.
console.log(JSON.stringify([{ h: -1, ...list[last - 9] } as Eight, { ...list[last - 10], ...list[last - 11] } as Eight, { ...list[last - 12], a: 0 } as Eight]));

// Members that lie in the cell.
function whole(names: Name[], seed: number): Inline {
  const made = {} as Inline;
  for (const name of names) {
    if (name === "b") made.b = "b" + seed;
    else made[name] = seed + name.charCodeAt(0);
  }
  return made;
}
const inCell: Inline[] = [];
for (let at = 0; at < count; at++) inCell.push(whole(order(at * 3 + 1), at));
const inCellTyped = inCell.map((value): Inline => ({ ...value }));
const inCellUntyped = inCell.map((value: any) => ({ ...value }));
console.log(sumOf(inCell), sumOf(inCellTyped), sumOf(inCellUntyped));
