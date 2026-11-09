// What stands in place of an operator that plain Bun decides takes the name of the variable, as it does under plain Bun.
const chosen = true ? function () {} : 0;
const both = 1 && function () {};
const either = 0 || function () {};
const fallback = null ?? function () {};
const chosenClass = false ? 0 : class {};
const bothClass = "x" && class {};
const eitherClass = "" || class {};
const fallbackClass = undefined ?? class {};
const arrow = true ? () => {} : 0;
const kept = Math.random() < 2 ? function () {} : 0;
const names = [chosen, both, either, fallback, chosenClass, bothClass, eitherClass, fallbackClass, arrow, kept];
console.log(names.map(it => JSON.stringify(it.name)).join(" "));
