import { add, readWord } from "./reads.ts";
import { plain, Shared, change, construct } from "./values.js";
interface Holder {
  words: string[];
  word: string | undefined;
}
function storeInLoop(holder: Holder, count: number): any {
  for (let turn = 0; turn < count; turn++) {
    for (let inner = 0; inner < 3; inner++) {
      try {
        const length = holder.word!.length;
      } catch (error) {}
      change(holder, turn);
    }
  }
}
const holders: any[] = [
  () => Shared,
  () => Object.assign(Shared, { words: "x y z".split(" "), word: "" }),
  () => Object.assign(Shared, { words: [], word: true as any }),
];
for (const make of holders) {
  let holder: any;
  try {
    holder = make();
  } catch (error) {
    continue;
  }
  try {
    console.log(String(readWord(holder, 4)));
  } catch (error) {}
  try {
    console.log(String(storeInLoop(holder, 20)));
  } catch (error) {}
}
console.log(construct(readWord));
export { plain, add, readWord };
