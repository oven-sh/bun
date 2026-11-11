const numbers: number[] = JSON.parse("[0,1,2,3,8,63,64,65,66,200]");
const whole: number[] = [], fractions: number[] = [], texts: string[] = [], mixed: unknown[] = [];
function refill(many: number, seed: number): string {
  whole.length = 0; fractions.length = 0; texts.length = 0; mixed.length = 0;
  for (let i = 0; i < many; i++) { whole.push(seed + i); fractions.push(seed + i + 0.5); texts.push("t" + (seed + i)); mixed.push(i & 1 ? i : "m" + i); }
  return whole.length + ":" + whole.join("").length + ":" + fractions.join("").length + ":" + texts.join("").length + ":" + mixed.join("").length;
}
function cutTo(list: unknown[], to: number): string { list.length = to >>> 0; const at = to >>> 0; return list.length + ":" + (at in list) + ":" + String(list[at]) + ":" + String(list[at - 1]); }
let said = "";
for (const many of numbers) said += refill(many, many) + " ";
console.log(said);
for (const many of numbers) { refill(200, 1); console.log(many, cutTo(whole, many), cutTo(fractions, many), cutTo(texts, many), cutTo(mixed, many)); whole.length = 201; fractions.length = 201; texts.length = 201; console.log(many in whole, whole[many], many in fractions, fractions[many], many in texts, texts[many], 200 in whole); }
