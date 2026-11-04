// `const b: number[] = [...list]` of a list from outside: the text says numbers, and the copy holds what the list held, numbers or not, holes as undefined, and goes on as any list does.
const texts = ["[]", "[1]", "[1,2,3]", "[1.5]", "[1,2.5,3]", "[-0,0]", "[2147483648,-2147483649]", '[1,"a"]', "[null,1]", "[1,[2]]", '[{"a":1}]', "[true,1.5]", "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]"];
function given(text: string): number[] {
  return JSON.parse(text) as number[];
}
function show(list: number[]): string {
  let text = "";
  for (let k = 0; k < list.length; k++) text += (k in list ? (Object.is(list[k], -0) ? "-0" : JSON.stringify(list[k]) ?? "undefined") : "hole") + " ";
  return text + "(" + list.length + ")";
}
function copied(list: number[]): string {
  const b: number[] = [...list];
  return show(b);
}
function summed(list: number[]): string {
  const b = [...list];
  let sum = 0;
  for (let k = 0; k < b.length; k++) sum += b[k]!;
  return String(sum);
}
function twice(list: number[]): string {
  const b = [...list, ...list];
  return show(b);
}
function changed(list: number[]): string {
  const b = [...list];
  b.push(0.5);
  b[0] = 7;
  (b as unknown[]).push("end");
  b.length = b.length - 1;
  return show(b) + " " + show(list);
}
function holed(list: number[]): string {
  const source = [...list];
  delete source[0];
  const b = [...source];
  return show(b) + " " + (0 in b) + " " + show(source);
}
class Keeper {
  kept: number[];
  static first: number[] = [...given("[4,5.5]")];
  constructor(list: number[]) {
    this.kept = [...list];
  }
  copy(): string {
    const b: number[] = [...this.kept];
    return show(b) + " " + show(Keeper.first);
  }
}
const atTheTopLevel: number[] = [...given('[1,"two",3.5]')];
console.log(show(atTheTopLevel), atTheTopLevel[0]! + atTheTopLevel[2]!);
for (const text of texts) {
  console.log(text, "|", copied(given(text)), "|", summed(given(text)), "|", twice(given(text)), "|", changed(given(text)), "|", holed(given(text)), "|", new Keeper(given(text)).copy());
}
