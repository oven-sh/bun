// Each turn of a loop has a scope of its own whose closure is only called; every third turn throws between the making of the scope and its last use, and the handler goes on with the next turn.
function deed(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    try {
      let seen = i * 10;
      const read = () => seen;
      const bump = () => {
        seen++;
      };
      bump();
      if (i % 3 === 1) throw new Error("turn " + String(read()));
      bump();
      out += String(read()) + " ";
    } catch (e) {
      out += "[" + (e as Error).message + "] ";
    }
  }
  return out;
}
console.log(deed(1));
console.log(deed(7));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(5);
console.log(last);
