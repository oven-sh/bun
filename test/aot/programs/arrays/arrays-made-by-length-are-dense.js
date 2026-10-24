// new Array(n).fill(v), Array.from({ length: n }), [...Array(n).keys()] and friends never have holes. Every array has its own reader.
const n = process.argv.length + 4;

const filled = new Array(n).fill(7);
function readFilled() { let sum = 0; for (let i = 0; i < filled.length; i++) sum += filled[i]; return sum; }

const filledWithText = Array(n).fill("x");
function readFilledWithText() { let text = ""; for (let i = 0; i < filledWithText.length; i++) text += filledWithText[i]; return text; }

const mapped = Array.from({ length: n }, (_, i) => i * 2);
function readMapped() { let sum = 0; for (let i = 0; i < mapped.length; i++) sum += mapped[i]; return sum; }

const undefinedOnly = Array.from({ length: n });
function readUndefinedOnly() { let text = ""; for (let i = 0; i < undefinedOnly.length; i++) text += String(undefinedOnly[i]) + (i in undefinedOnly ? "," : "!"); return text; }

const filledAndMapped = new Array(n).fill(1).map((value, i) => value + i);
function readFilledAndMapped() { let sum = 0; for (let i = 0; i < filledAndMapped.length; i++) sum += filledAndMapped[i]; return sum; }

const indexes = [...Array(n).keys()];
function readIndexes() { let sum = 0; for (let i = 0; i < indexes.length; i++) sum += indexes[i]; return sum; }

const fromTextLength = new Array("3").fill(5);
function readFromTextLength() { let text = ""; for (let i = 0; i < fromTextLength.length; i++) text += String(fromTextLength[i]) + (i in fromTextLength ? "," : "!"); return text; }

const fromObjectLength = Array.from({ length: { valueOf() { return 3; } } }, (_, i) => i);
function readFromObjectLength() { let text = ""; for (let i = 0; i < fromObjectLength.length; i++) text += String(fromObjectLength[i]) + (i in fromObjectLength ? "," : "!"); return text; }

const notFilled = new Array(n);
function readNotFilled() { let text = ""; for (let i = 0; i < notFilled.length; i++) text += String(notFilled[i]) + (i in notFilled ? "," : "!"); return text; }

const partlyFilled = new Array(n).fill(1, 2);
function readPartlyFilled() { let text = ""; for (let i = 0; i < partlyFilled.length; i++) text += String(partlyFilled[i]) + (i in partlyFilled ? "," : "!"); return text; }

const grown = new Array(2).fill(0);
grown[5] = 1;
function readGrown() { let text = ""; for (let i = 0; i < grown.length; i++) text += String(grown[i]) + (i in grown ? "," : "!"); return text; }

for (let round = 0; round < 3; round++)
  console.log(readFilled(), readFilledWithText(), readMapped(), readUndefinedOnly(), readFilledAndMapped(), readIndexes(), readFromTextLength(), readFromObjectLength(), readNotFilled(), readPartlyFilled(), readGrown());
for (const bad of [-1, 1.5, NaN, 2 ** 32]) {
  try { console.log(new Array(bad).fill(0).length); } catch (error) { console.log(error.name); }
}
