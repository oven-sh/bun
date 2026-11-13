// The row of Buffer.from that takes this says `any`: it is refused inside, and described.
const table = new Map([[1, new URL("http://made.up/a")]]);
table.constructor = false;
let text = "no refusal";
try {
  Buffer.from(table);
} catch (error) {
  text = `${error}`;
}
console.log(`${text.includes("href")} ${text.includes("made.up")}`);
