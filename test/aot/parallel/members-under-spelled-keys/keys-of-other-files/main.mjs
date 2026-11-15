// Keys that other files export: constants, a binding that moves, a default, a namespace, a name through two files.
import byDefault, { fixed, word, moving, move, late, renamed } from "./keys.mjs";
import { throughTwoFiles, fixed as star } from "./again.mjs";
import * as all from "./keys.mjs";
class First {
  [fixed]() { return "fixed"; }
  [word]() { return "word"; }
  [moving]() { return "moving"; }
  [late]() { return "late"; }
  [byDefault]() { return "default"; }
  plain() { return "plain"; }
}
const before = moving;
const after = move();
class Second {
  [moving]() { return "moved"; }
  [renamed]() { return "renamed"; }
  [all.word]() { return "namespace"; }
  get [throughTwoFiles]() { return "never: the later member is there"; }
  get [star]() { return "star"; }
  plain() { return "plain two"; }
}
function ask(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const said = new Set();
  for (let i = 0; i < list.length; i++) {
    const one = list[i];
    const found = [one[fixed], one[word], one[before], one[after], one[moving], one[late], one[byDefault], one.plain];
    said.add(found.map(f => typeof f === "function" ? f.call(one) : String(f)).join("|"));
  }
  return [...said].join(" / ") + work;
}
const list = [];
for (let i = 0; i < 300; i++) list.push(i & 1 ? new First() : new Second());
console.log(ask(list));
