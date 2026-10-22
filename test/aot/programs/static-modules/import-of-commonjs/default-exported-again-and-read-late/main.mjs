import { old } from "./outer.mjs";
function late() {
  return [typeof old, Object.keys(old).join(), old.make().length];
}
old.added = 1;
setTimeout(() => console.log(late().join(" ")), 0);
console.log("first");
