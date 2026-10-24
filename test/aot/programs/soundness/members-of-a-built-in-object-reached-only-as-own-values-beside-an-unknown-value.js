// Nothing names console.table or a function of node:path here. They are reached as own values of an object that a variable holds
// beside a value nobody knows and beside more escaped objects than a call has arms, so they have to be in the executable.
import * as path from "node:path";

const nobodyKnows = globalThis.definedNowhere;
const plain = [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }];
for (const object of plain) nobodyKnows?.(object);
nobodyKnows?.(console);
nobodyKnows?.(path.posix);

function choose(index) {
  if (index < plain.length) return plain[index];
  if (index === plain.length) return console;
  if (index === plain.length + 1) return path.posix;
  return nobodyKnows;
}

const found = [];
for (let index = 0; index < plain.length + 2; index++) {
  const holder = choose(index);
  for (const value of Object.values(holder)) {
    if (typeof value !== "function") {
      if (typeof value !== "object") found.push(value);
    } else if (holder === console) {
      if (value.name === "table") value([{ x: 1, y: 2 }]);
    } else {
      try {
        found.push(JSON.stringify(value("/some/where/file.txt")));
      } catch (error) {
        found.push(error.constructor.name);
      }
    }
  }
}
console.log(found.join(" "));
