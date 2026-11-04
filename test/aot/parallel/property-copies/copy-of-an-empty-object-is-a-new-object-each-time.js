// An object that is written without a member is only spread: each copy of it is a new, ordinary, empty object that takes any name later.
function deed(key, v) {
  const none = {};
  return { ...none, [key]: v };
}
function bare() {
  const none = {};
  return { ...none };
}
const first = bare();
const second = bare();
first.x = 1;
console.log(first === second, JSON.stringify(first), JSON.stringify(second), Object.getPrototypeOf(first) === Object.prototype);
console.log(JSON.stringify(deed("k", 1)), JSON.stringify(deed("1", 2)), Object.keys(deed("__proto__", 3)).join());
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(deed("k" + (i % 3), i));
console.log(last);
