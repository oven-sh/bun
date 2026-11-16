// Enums with constant values: names, reverse keys, their order, what is written to them and what each execution makes.
enum Color { Red, Green, Blue }
enum Flags { None = 0, A = 1 << 0, B = 1 << 10, C = 1 << 20, All = A | B | C }
enum High { Last = 4294967294, None = 4294967295, More = 4294967296, Three = 3 }
enum Mixed { Zero, Two = "two", Three = 3, Nought = "0" }
enum Same { One = 1, Uno = 1, Two = 2 }
enum Below { Minus = -1, Zero, One }
enum Odd { Half = 0.5, One = 1 }
enum Names { constructor, toString = 3, "some name" = 1, length }
enum Alone { Only = "only" }
const all: any[] = [Color, Flags, High, Mixed, Same, Below, Odd, Names, Alone];
for (const e of all) console.log(JSON.stringify(e), Object.keys(e).join(), Object.values(e).join(), Object.getPrototypeOf(e) === Object.prototype);
function lengths(turns: number) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += (Color[k % 3] as any).length + (Color[k % 4] ?? "none").length;
  return n;
}
console.log(lengths(1000));
function make() {
  enum Inner { First, Second = 5, Third }
  return Inner as any;
}
const first = make();
const second = make();
first.First = "written";
first[5] = "other";
delete first.Third;
first.New = 1;
console.log(first === second, JSON.stringify(first), JSON.stringify(second), JSON.stringify(make()));
function reads(turns: number) {
  let text = "";
  for (let k = 0; k < turns; k++) {
    text += Color[k % 3] + (k % 5 ? "" : "|");
    if (k === 7) (Color as any)[1] = 42;
    if (k === 11) (Color as any)[2] = undefined;
  }
  return text;
}
console.log(reads(20), JSON.stringify(Color));
Object.freeze(Flags);
console.log(Object.isFrozen(Flags), Flags[1 << 10], Flags[3] === undefined, (Flags as any)["C"], Flags[Flags.All]);
