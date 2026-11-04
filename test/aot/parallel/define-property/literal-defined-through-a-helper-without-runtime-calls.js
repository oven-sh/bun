// COUNT: operation:operationAOTDefineOwnProperty = 0 Todo: the definition is one operation of the run time, without the descriptor object, until it is a store into the slot. Until then it was a call of the host function Object.defineProperty, which no operation counts
function define(object, key, value) {
  return Object.defineProperty(object, key, { value });
}
let sum = 0;
let last;
for (let turn = 0; turn < 2000; turn++) {
  const rule = { pattern: "a" + (turn & 7), negative: false };
  define(rule, "regex", turn);
  define(rule, "checkRegex", turn + 1);
  sum += rule.regex + rule.checkRegex;
  last = rule;
}
console.log(sum);
console.log(JSON.stringify(Object.getOwnPropertyDescriptors(last)), Object.keys(last).join(), Object.getOwnPropertyNames(last).join(), JSON.stringify(last));
