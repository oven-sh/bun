// 300 turns: the file throws in every run but each tenth
let answered = 0;
for (let turn = 0; turn < 300; turn++) {
  try { throw 0; }
  catch { answered += require("./lib.cjs").one; }
  finally { continue; }
}
console.log(answered, globalThis.runs);
