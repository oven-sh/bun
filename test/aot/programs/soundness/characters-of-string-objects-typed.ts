// The declared type String has an index signature that answers string. A String object keeps that promise below its length, whoever made it.
function kindOf(value: unknown): string {
  return typeof value;
}
function characterAt(text: String, index: number): string {
  return text[index];
}
function lengthOfCharacter(text: String, index: number): number {
  return text[index].length;
}

const text: String = new String("abc");
const second: string = text[1];
console.log(second === undefined, typeof second, second + "!", second.length);
console.log(characterAt(text, 0), characterAt(new String("xyz"), 2), lengthOfCharacter(text, 2), kindOf(text[1]));

const converted: String = Object("abc");
console.log(converted[1], converted[1].length, kindOf(converted[0]));

class Label extends String {
  tag: number = 1;
  first(): string {
    return this[0];
  }
}
const label = new Label("name");
console.log(label.first(), label[3], label[1].length, label.tag, label.length, Object.keys(label).join());

const copied: string[] = Object.assign([] as string[], new String("ab"));
console.log(copied[0], copied[0].length, copied.length);
const values: string[] = Object.values(new String("ab"));
console.log(values[1], values[1].length);
const spread: { [index: number]: string } = { ...new String("ab") };
console.log(spread[0], spread[1].length);
const mapped: number[] = Array.prototype.map.call(new String("ab"), (character: string) => character.length) as number[];
console.log(mapped.join());

const list: String[] = [new String("ab"), new String("cd")];
let joined = "";
for (const entry of list) for (let index = 0; index < entry.length; index++) joined += entry[index];
console.log(joined);

const maybe: string | undefined = (text as { [index: number]: string | undefined })[3];
console.log(maybe === undefined, kindOf(maybe), maybe ?? "none");
