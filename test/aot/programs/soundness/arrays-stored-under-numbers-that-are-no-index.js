// A store under a number that is no array index (-1, 1.5, a number nobody knows) adds a property under that name. Reads, tests, deletes and every listing of the keys see it.
function put(a, k, v) {
  a[k] = v;
}
function get(a, k) {
  return a[k];
}
function has(a, k) {
  return k in a;
}
const list = [1, 2, 3];
put(list, -1, "minus");
put(list, 1.5, "half");
console.log(get(list, -1), get(list, 1.5), has(list, -1), has(list, 1.5), list[-1], list[1.5]);
console.log(Object.keys(list).join(), JSON.stringify(Object.entries(list)), list.length);
let names = "";
for (const name in list) names += name + ";";
console.log(names);

const down = [10, 20, 30];
for (let i = 2; i >= -2; i--) down[i] = i;
let text = "";
for (let i = 2; i >= -2; i--) text += down[i] + ",";
console.log(text, Object.keys(down).join(), down.hasOwnProperty(-1), Object.getOwnPropertyNames(down).join());

const byArgument = ["a"];
const offset = process.argv.length - 100;
byArgument[offset] = "far below";
console.log(byArgument[offset], byArgument[process.argv.length - 100], Object.keys(byArgument).length, { ...byArgument }[offset]);
console.log([...byArgument].length, byArgument.concat(["b"]).length, byArgument.slice().length, structuredClone(byArgument).length);

function localArray(k) {
  const a = [1, 2];
  a[k] = 7;
  return a[k] + a.length + Object.keys(a).length;
}
console.log(localArray(-1), localArray(0.5), localArray(1), localArray(5));
function localConstant() {
  const a = [1, 2];
  const k = -1;
  a[k] = 7;
  let total = 0;
  for (const name in a) total += a[name];
  return total + "," + Object.keys(a).join() + "," + JSON.stringify(a) + "," + (k in a) + "," + delete a[k] + "," + (k in a);
}
console.log(localConstant());
function copy(a) {
  const b = [];
  for (let i = -1; i < a.length; i++) b[i] = a[i];
  return b;
}
const copied = copy([4, 5]);
console.log(copied.length, Object.keys(copied).join(), copied[-1], Object.getOwnPropertyDescriptor(copied, "-1") !== undefined, Object.entries(copied).length);
function countOwn(a) {
  let n = 0;
  for (const k of Reflect.ownKeys(a)) n++;
  return n;
}
console.log(countOwn(copied), Object.values(copied).length, Object.assign({}, copied)[-1] === undefined, "-1" in { ...copied });
class Stack {
  items = [];
  top = -1;
  push(x) { this.items[++this.top] = x; }
  pop() { const x = this.items[this.top]; this.items[this.top--] = undefined; return x; }
}
const stack = new Stack();
stack.push(1);
console.log(stack.pop(), stack.pop(), stack.top, Object.keys(stack.items).join(), stack.items.length, stack.items[-1], "-1" in stack.items);
const frozenLater = [1, 2];
frozenLater[frozenLater.indexOf(9)] = "not found";
console.log(Object.keys(frozenLater).join(), frozenLater[frozenLater.indexOf(9)], frozenLater.at(-1), frozenLater.lastIndexOf("not found"), frozenLater.includes("not found"));
