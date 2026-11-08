// Prints the names in the stack frames of functions with typed parameters, called as values and by name, before and after the program gives them another name, for arguments of the declared type and of another: functions that are made once, and function objects that one place makes under many names.
import { EventEmitter } from "node:events";
const namesIn = (stack: string) =>
  stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .filter(name => /^(heard|counted|Tally|add|first|second|third|fourth|shown|made|one)\w*$/.test(name))
    .join(" < ");
let seen = "";
const emitter = new EventEmitter();
const heard = (i: number) => void (seen = i === 0 ? "" : new Error("x").stack!);
function counted(i: number, text: string): number {
  seen = new Error("x").stack!;
  return i + text.length;
}
class Tally {
  total = 0;
  add(i: number): number {
    seen = new Error("x").stack!;
    return (this.total += i);
  }
}
const tally = new Tally();
emitter.on("heard", heard);
emitter.on("counted", counted);
emitter.on("added", (i: number) => void tally.add(i));

function show(label: string) {
  const said: string[] = [];
  for (const argument of [1, 2.5, "text", undefined, { valueOf: () => 3 }]) {
    for (const event of ["heard", "counted", "added"]) {
      seen = "";
      emitter.emit(event, argument, "ab");
      said.push(namesIn(seen));
    }
  }
  console.log(label, "|", said.join(" . "));
}
for (let round = 0; round < 200; round++) emitter.emit("heard", 0);
show("as written");
Object.defineProperty(heard, "name", { value: "first" });
Object.defineProperty(counted, "name", { value: "second" });
Object.defineProperty(Tally.prototype.add, "name", { value: "third" });
show("named");
Object.defineProperty(heard, "name", { value: "fourth" });
show("named again");
(heard as any).displayName = "shownHeard";
(counted as any).displayName = "shownCounted";
(Tally.prototype.add as any).displayName = "shownAdd";
show("with a display name");
const rename = (made: Function, name: string) => Object.defineProperty(made, "name", { value: name });
for (const [made, name] of [
  [heard, "heardAgain"],
  [counted, "countedAgain"],
] as [Function, string][])
  rename(made, name);
delete (heard as any).displayName;
delete (counted as any).displayName;
show("named by a helper");

function make(name: string) {
  const made = (i: number, more: (i: number) => void = () => {}) => {
    seen = new Error("x").stack!;
    more(i);
  };
  Object.defineProperty(made, "name", { value: name });
  return made;
}
const many = ["oneA", "oneB", "oneC", "oneD"].map(make);
const said: string[] = [];
for (const argument of [1, "text", 2.5, null]) {
  for (const [index, made] of many.entries()) {
    (made as any)(argument);
    said.push(namesIn(seen));
    (made as any)(argument, many[(index + 1) & 3]);
    said.push(namesIn(seen));
  }
}
console.log("one place, many names |", said.join(" . "));
