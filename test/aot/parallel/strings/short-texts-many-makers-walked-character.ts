// Texts of no, one, two, three and more characters, each made while the program runs, go through one loop over their characters.
function countOf(text: string, unit: number): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === unit) count++;
  }
  return count;
}

const lengths = [0, 1, 2, 3, 4, 7, 8, 15, 16];
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const codesFrom = (first: number, length: number) => Array.from({ length }, (_, index) => first + index);
const makers: [string, (length: number) => string][] = [
  ["upper-cased", length => letters.toLowerCase().slice(0, length).toUpperCase()],
  ["joined", length => Array.from({ length }, (_, index) => letters[index]).join("")],
  [
    "added up",
    length => {
      let text = "";
      for (let index = 0; index < length; index++) text += letters[index];
      return text;
    },
  ],
  ["cut out", length => (letters + String(Date.now())).slice(0, length)],
  ["a key", length => Object.keys({ [letters.toLowerCase().slice(0, length).toUpperCase()]: 1 })[0]],
  ["from codes", length => String.fromCharCode(...codesFrom(65, length))],
  ["from wide codes", length => String.fromCharCode(...codesFrom(0x3b1, length))],
  ["decoded", length => new TextDecoder().decode(new Uint8Array(length).fill(65))],
  ["out of a Buffer", length => Buffer.alloc(length, 65).toString("latin1")],
  ["parsed", length => JSON.parse(JSON.stringify({ text: "A".repeat(length) })).text],
  ["of a number", length => String(10 ** Math.max(length - 1, 0)).slice(0, length)],
];
for (const [name, make] of makers) {
  const row = lengths.map(length => {
    const text = make(length);
    return countOf(text, 65) + "/" + countOf(text, 0x3b1) + "/" + countOf(text, 48);
  });
  console.log(name, row.join(" "));
}

let inTheEnvironment = 0;
for (const key in process.env) inTheEnvironment += countOf(key, 0) + countOf(process.env[key]!, 0);
console.log("the environment", inTheEnvironment);
