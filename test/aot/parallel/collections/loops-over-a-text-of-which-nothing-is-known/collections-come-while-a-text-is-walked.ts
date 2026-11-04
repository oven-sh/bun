// What stands for the iterator of a text is held by the loop alone, also while the loop is suspended. Whole collections come between the steps, and what they free is overwritten and filled again.
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useZombieMode=1
import vm from "node:vm";
const box: any = {}; (globalThis as any).box = box;
let kept: unknown[] = [];
function churn() { kept = []; Bun.gc(true); for (let index = 0; index < 5000; index++) kept.push(index % 3 === 0 ? { text: "x" + index, position: index, next: index } : index % 3 === 1 ? () => index : "s" + index); Bun.gc(true); }
function walk(name: string) { const seen: string[] = []; for (const piece of box[name]) { seen.push(piece); churn(); } return seen.join("|"); }
function* suspended(name: string) { for (const piece of box[name]) { churn(); yield piece; } }
async function awaits(name: string) { const seen: string[] = []; for (const piece of box[name]) { await null; churn(); seen.push(piece); } return seen.join("|"); }
for (let turn = 0; turn < 3; turn++) {
  box.text = "ab" + String(turn) + "😀" + "z".repeat(2); box.made = ["p", "q", String(turn)].join("");
  console.log(walk("text"), walk("made"));
  const it = suspended("text"); const first = it.next().value; churn(); console.log(first, [...it].join("|"));
  console.log(await awaits("text"), (await Promise.all([awaits("made"), awaits("text")])).join(" "));
  box.theirs = vm.runInNewContext("'from' + ' another realm'"); box.object = vm.runInNewContext("new String('xy')"); console.log(walk("theirs"), walk("object"));
}
