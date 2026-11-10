// A text of 16-bit letters goes to the long road of the conversion (about 28 instructions a letter), also where nothing changes. What that road gives is remembered under the cell of the text,
// in the weak table that the prelude in front of the operation reads: the same text asked again does not reach the operation.
// COUNTER: operationAOTStringToLowerCase <= 8
// COUNTER: operationAOTStringToUpperCase <= 8
const texts = JSON.parse(JSON.stringify(["альфа бета".repeat(20), "АЛЬФА БЕТА".repeat(20), ("中" + "plain ascii ".repeat(30)).slice(1), "straße ÿ".repeat(12)]));
let sum = 0;
for (let turn = 0; turn < 400; turn++) for (const text of texts) sum += text.toLowerCase().length * 3 + text.toUpperCase().length;
console.log(sum, texts.map((text) => text.toLowerCase().slice(0, 12) + "|" + text.toUpperCase().slice(0, 12)).join(" ; "));
