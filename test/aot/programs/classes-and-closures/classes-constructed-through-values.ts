const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
class Pair { first: number; second: string; rest: number[] = []; note?: string; constructor(first: number, second: string) { this.first = first; this.second = second; } total() { return this.first + this.second.length + this.rest.length; } }
class Wide extends Pair { a = 1; b = 2; c = 3; d = "four"; e: Pair | null = null; constructor(first: number, second: string) { super(first, second); this.rest.push(first); } }
class Empty { }
class SeesNewTarget { which: string; constructor() { this.which = new.target === SeesNewTarget ? "itself" : new.target.name; } }
class Heir extends SeesNewTarget { }
const classes: any[] = [Pair, Wide, Empty, SeesNewTarget, Heir];
const kept: any[] = [];
let sum = 0;
let withNote = 0;
for (let round = 0; round < 3000; round++) {
  const made = new classes[round % classes.length](round, "s" + round);
  if (Object.getPrototypeOf(made) !== classes[round % classes.length].prototype) throw new Error("wrong prototype");
  if (made instanceof Pair) {
    sum += made.total();
    if (made.rest === kept[kept.length - 1]?.rest) throw new Error("shared array");
    if ("note" in made) withNote++;
  }
  if (round % 211 === 0) kept.push(made);
  if (round % 700 === 0) collect();
}
console.log(sum, withNote, kept.length, kept.map(made => made.constructor.name + ":" + Object.keys(made).join("|")).join(" "));
console.log(new classes[3]().which, new classes[4]().which);
for (let round = 0; round < 6; round++) {
  const throughBase = Reflect.construct(Pair, [round, "r"], Wide) as any;
  const itself = new classes[1](round, "w");
  const base = new classes[0](round, "p");
  console.log(Object.getPrototypeOf(throughBase) === Wide.prototype, Object.keys(throughBase).join("|"), Object.keys(itself).join("|"), itself.total(), Object.keys(base).join("|"), Object.getPrototypeOf(base) === Pair.prototype);
}
class C0 { tag = 0;  constructor(public value: number) {} }
class C1 { tag = 1; f0 = 0; constructor(public value: number) {} }
class C2 { tag = 2; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C3 { tag = 3; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C4 { tag = 4; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
class C5 { tag = 5; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; constructor(public value: number) {} }
class C6 { tag = 6; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; constructor(public value: number) {} }
class C7 { tag = 7;  constructor(public value: number) {} }
class C8 { tag = 8; f0 = 0; constructor(public value: number) {} }
class C9 { tag = 9; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C10 { tag = 10; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C11 { tag = 11; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
class C12 { tag = 12; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; constructor(public value: number) {} }
class C13 { tag = 13; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; constructor(public value: number) {} }
class C14 { tag = 14;  constructor(public value: number) {} }
class C15 { tag = 15; f0 = 0; constructor(public value: number) {} }
class C16 { tag = 16; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C17 { tag = 17; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C18 { tag = 18; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
class C19 { tag = 19; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; constructor(public value: number) {} }
class C20 { tag = 20; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; constructor(public value: number) {} }
class C21 { tag = 21;  constructor(public value: number) {} }
class C22 { tag = 22; f0 = 0; constructor(public value: number) {} }
class C23 { tag = 23; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C24 { tag = 24; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C25 { tag = 25; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
class C26 { tag = 26; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; constructor(public value: number) {} }
class C27 { tag = 27; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; constructor(public value: number) {} }
class C28 { tag = 28;  constructor(public value: number) {} }
class C29 { tag = 29; f0 = 0; constructor(public value: number) {} }
class C30 { tag = 30; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C31 { tag = 31; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C32 { tag = 32; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
class C33 { tag = 33; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; constructor(public value: number) {} }
class C34 { tag = 34; f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; constructor(public value: number) {} }
class C35 { tag = 35;  constructor(public value: number) {} }
class C36 { tag = 36; f0 = 0; constructor(public value: number) {} }
class C37 { tag = 37; f0 = 0; f1 = 1; constructor(public value: number) {} }
class C38 { tag = 38; f0 = 0; f1 = 1; f2 = 2; constructor(public value: number) {} }
class C39 { tag = 39; f0 = 0; f1 = 1; f2 = 2; f3 = 3; constructor(public value: number) {} }
const many: any[] = [C0, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16, C17, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39];
let tags = 0;
for (let round = 0; round < 4000; round++) {
  const made = new many[(round * 7) % 40](round);
  if (Object.getPrototypeOf(made) !== many[(round * 7) % 40].prototype) throw new Error("wrong prototype");
  tags += made.tag * 1000 + made.value + Object.keys(made).length;
  if (round % 900 === 0) collect();
}
console.log(tags);
