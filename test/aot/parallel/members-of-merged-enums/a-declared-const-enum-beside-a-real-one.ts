declare const enum Mode { Off, Fast }
const enum Mode { Slow = 2 }
function probe() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let said = "";
  try { said = (Mode.Fast === 1 ? "folded" : "read at run time") + ":" + String(Mode.Fast); } catch (e) { said = (e as Error).name; }
  return said + ":" + Mode.Slow + ":" + work;
}
console.log(probe());
