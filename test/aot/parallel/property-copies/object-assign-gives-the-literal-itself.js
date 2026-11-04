// Object.assign into a literal gives that very literal: the variable that holds it and the result of the call are one object, before and behind later stores.
function deed(i) {
  const target = { c: 1 };
  const result = Object.assign(target, { a: i, b: 1 }, { c: "over", d: 4 });
  result.late = 1;
  target.later = 2;
  return [result === target, Object.keys(target).join(), JSON.stringify(result)].join(" ");
}
console.log(deed(1));
let last = "";
for (let i = 0; i < 300; i++) last = deed(i);
console.log(last);
