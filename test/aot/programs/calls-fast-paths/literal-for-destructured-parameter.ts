// A function whose parameter is a pattern is too large to be inlined. Where it is called with an object literal, the literal is never made: the values go to the function as they are.
// IR= 0 caller : =?L[0-9]+ = NewObject 
// IR= 0 inLoop : =?L[0-9]+ = NewObject 
interface Options {
  count: number;
  word: string;
  separator?: string;
}
function repeat({ count, word, separator }: Options): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    if (i > 0 && separator !== undefined) text += separator;
    text += word;
  }
  let vowels = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 97 || unit === 101 || unit === 105 || unit === 111 || unit === 117) vowels++;
  }
  let digits = "";
  for (let n = vowels; n > 0; n = Math.floor(n / 10)) digits = String(n % 10) + digits;
  return text + ":" + (digits === "" ? "0" : digits);
}
function caller(n: number): string {
  return repeat({ count: n, word: "ab" }) + " " + repeat({ count: 2, word: "eo", separator: "-" });
}
function inLoop(n: number): number {
  let length = 0;
  for (let i = 0; i < n; i++) length += repeat({ count: i, word: "xa", separator: "," }).length;
  return length;
}
console.log(caller(3), inLoop(5));
