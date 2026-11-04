enum Color { Red, Green = 5, Blue }
function read(): string { let s = 0; for (let i = 0; i < 3; i++) s += Color.Green; return s + " " + Color.Red + " " + Color[5] + " " + Color.Blue; }
console.log(read(), Object.keys(Color).join());
const held: any = Color;
if (process.argv.length < 100) { held.Green = 7; held[5] = "Grey"; }
console.log(read(), held.Green, held[5], Object.keys(Color).join());
