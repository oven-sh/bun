const name: string = "quire".replace(/^/, "re");
function pick(turn: number): string {
  if ("requir".replace(/$/, "e") !== name) return "differs";
  return turn % 2 === 0 ? "ab".replace(/$/, "c") : "bc".replace(/^/, "a");
}
let same = 0;
for (let turn = 0; turn < 300; turn++) if (pick(turn) === "abc") same++;
console.log(name, same, name.length);
