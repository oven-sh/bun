// Compiled code closes the text of a parse into a declared type itself where the value ends the text and the run time owns nothing for it. The run time is
// asked to close a text that goes on behind the value, which it reads to the end, and a 16-bit text, whose original characters it holds.
// Only the jsc shell with --aotCountsPath=<path> can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number);
const canCount = typeof aotOperationCount === "function";
const closedByRunTime = () =>
  typeof aotOperationCount === "function" ? aotOperationCount("operationAOTJSONSourceClose") : 0;

interface Point {
  x: number;
  y: number;
  label: string;
}
function parsePoint(text: string): Point {
  return JSON.parse(text) as Point;
}
function sumOf(texts: string[], rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < texts.length; index++) {
      const point = parsePoint(texts[index]);
      sum += point.x * 3 + point.y + point.label.length;
    }
  }
  return sum;
}

const rounds = 200;
const narrowTexts = ['{"x":1,"y":2,"label":"a"}', ' {"x":3,"y":4,"label":"bc"}', '{"x":5,"y":6,"label":"é"}'];
const paddedTexts = ['{"x":1,"y":2,"label":"a"}\n', '{"x":3,"y":4,"label":"bc"} \t '];
const wideTexts = ['{"x":1,"y":2,"label":"日"}', '{"x":3,"y":4,"label":"日本"}'];
sumOf(narrowTexts, 1);
sumOf(paddedTexts, 1);
sumOf(wideTexts, 1);

const before = closedByRunTime();
console.log("8-bit texts: " + sumOf(narrowTexts, rounds) + ", closed by the run time: " + (closedByRunTime() - before));

function reportClosedByRunTime(label: string, texts: string[]): void {
  const before = closedByRunTime();
  const sum = sumOf(texts, rounds);
  const closes = closedByRunTime() - before;
  console.log(label + ": " + sum + ", all closed by the run time: " + (!canCount || closes === rounds * texts.length));
}
reportClosedByRunTime("8-bit texts with white space at the end", paddedTexts);
reportClosedByRunTime("16-bit texts", wideTexts);

for (const text of ['{"x":1,"y":2,"label":"a"} x', '{"x":1,"y":2,"label":"a"}}', '{"x":1,"y":2,"label":"a"']) {
  try {
    console.log(JSON.stringify(parsePoint(text)));
  } catch (error) {
    console.log((error as Error).name);
  }
}
console.log("after the failures: " + sumOf(narrowTexts, 2));
