interface Size { width: number; height: number }
const N: Size = Object.create(null);
N.width = 1;
N.height = 2;
const parsed: Size = JSON.parse('{"width":3,"height":4}');
const literal: Size = { width: 5, height: 6 };
function ask(s: Size): string { return [typeof s.toString, "toString" in s, Object.keys(s).join("+"), s.width * s.height, Object.getPrototypeOf(s) === null].join(); }
let said = "";
for (let i = 0; i < (+process.argv[2] || 3); i++) said = [ask(N), ask(parsed), ask(literal)].join(" | ");
console.log(said);
