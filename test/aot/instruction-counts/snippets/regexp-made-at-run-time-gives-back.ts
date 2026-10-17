// tests a line against a pattern that is made at run time and whose runs must give back
const operations = 100;
let marks = "";
const codes = [35, 35, 35, 35, 35, 35];
for (let i = 0; i < codes.length; i++) marks += String.fromCharCode(codes[i] + (Date.now() < 0 ? 1 : 0));
const mark = marks.charAt(3);
const heading = new RegExp("^(" + mark + "{1,6})[ \\t]+(.+?)[ \\t]*" + mark + "*[ \\t]*$");
const lines: string[] = [];
for (let i = 0; i < operations; i++) lines.push("#".repeat(1 + (i % 6)) + " A heading of some words " + i + " ##");
let total = 0;

kernel: {
  let matched = 0;
  for (let i = 0; i < lines.length; i++) if (heading.test(lines[i])) matched++;
  total += matched;
}

console.log(total);
