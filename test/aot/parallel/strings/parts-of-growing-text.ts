// Each kind of part that a text takes while it grows in a loop, at the edges of what compiled code writes into the buffer by itself.
const integers = [0, 9, 10, 99, 100, 12345, 9999999, 10000000, 99999999, 100000000, 100000001, 2147483647, -1, -9, -2147483648];
const numbers = [0, -0, 0.5, 1, 99999999, 100000000, 1e21, -1, NaN, Infinity, -Infinity, 4294967296, 1.5e-7, 123456.75];
const flags = [true, false, false, true];
const words: (string | null | undefined)[] = ["a", null, undefined, "", "é", "日本", "x".repeat(20), "y".repeat(5000)];

function sumOf(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + sum;
}

function joinIntegers(list: number[]): string {
  let text = "";
  for (const value of list) text += "id" + (value | 0) + ",";
  return text;
}

function joinLargeIntegers(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text += i * 49999999 + " ";
  return text;
}

function joinNumbers(list: number[]): string {
  let text = "";
  for (const value of list) text += value + ";";
  return text;
}

function joinFlags(list: boolean[]): string {
  let text = "";
  for (const flag of list) text += flag + "|";
  return text;
}

function joinWords(list: (string | null | undefined)[]): string {
  let text = "";
  for (const word of list) text += word + "/";
  return text;
}

function joinPieces(source: string): string {
  let text = "";
  for (let length = 0; length <= 40; length++) text += source.substring(length, length + length) + ".";
  return text;
}

function joinTexts(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    text += "ab";
    text += "cdefg";
    text += "éè";
    text += "1234567";
    text += "z";
    text += `${undefined}${null}${true}${false}`;
    text += "a text of more than sixteen characters";
    text += "日";
  }
  return text;
}

function readWhileGrowing(count: number): string {
  let text = "";
  let seen = 0;
  for (let i = 0; i < count; i++) {
    text += i;
    if (i % 7 === 0) seen += text.charCodeAt(text.length - 1) + text.length;
  }
  return text.length + ":" + seen;
}

function stopHalfWay(list: number[]): string {
  let text = "";
  try {
    for (const value of list) {
      text += "<" + value + ">";
      if (value === 100) throw new Error("stop");
    }
  } catch (error) {
    text += "!" + (error as Error).message;
  }
  return text;
}

console.log(joinIntegers(integers));
console.log(joinLargeIntegers(6));
console.log(joinNumbers(numbers));
console.log(joinFlags(flags));
console.log(sumOf(joinWords(words)));
console.log(joinPieces("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij"));
console.log(joinPieces("日本" + "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh"));
console.log(joinTexts(2));
console.log(sumOf(joinTexts(300)));
console.log(sumOf(joinIntegers(Array.from({ length: 3000 }, (_, i) => i * 37))));
console.log(readWhileGrowing(2000));
console.log(stopHalfWay(integers));
