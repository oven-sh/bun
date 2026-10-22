// Small bindings that stand side by side may be made together. Code that runs between two of them must still find the later one in its dead zone and the earlier one whole, and each object is made once.
const log: string[] = [];
function look(name: string, read: () => unknown): void {
  try { log.push(name + "=" + JSON.stringify(read())); } catch (error) { log.push(name + ":" + (error as Error).constructor.name); }
}
const first = { n: 1 };
const second = [1, 2];
const third = { first, second };
look("fourth early", () => fourth);
look("first", () => first);
const fourth = { m: 4 };
const fifth = [fourth];
var sixth = { v: 6 };
look("seventh early", () => seventh);
look("sixth", () => sixth);
look("ninth early", () => ninth);
let seventh = { w: 7 };
const eighth = { list: [seventh.w, 8] };
const ninth = new Map([["k", 9]]);
const tenth = { text: "ten", more: { deep: [10] } };
look("tenth at once", () => tenth);
const untouched = { never: "read at the start" };
const alsoUntouched = ["x", "y", "z"];
const holdsBoth = { untouched, alsoUntouched };
second.push(3);
function later(): void {
  fifth.push({ m: 5 });
  look("third", () => third);
  look("same first", () => third.first === first && third.second === second);
  look("fifth", () => fifth);
  look("same fourth", () => fifth[0] === fourth);
  look("eighth", () => eighth);
  look("ninth", () => [...ninth]);
  look("holdsBoth", () => holdsBoth);
  look("same untouched", () => holdsBoth.untouched === untouched && holdsBoth.alsoUntouched === alsoUntouched);
  untouched.never = "changed";
  look("seen through", () => holdsBoth.untouched.never);
  console.log(log.join("\n"));
}
setTimeout(later, 1);
