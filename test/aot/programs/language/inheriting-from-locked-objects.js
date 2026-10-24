// An object that inherits from a locked object assigns, defines and overrides as in plain Bun: the lock is on the object itself, and its members still read as writable.
const lines = [];
const plain = {};
plain.toString = () => "own toString";
plain.hasOwnProperty = () => "own hasOwnProperty";
lines.push(String(plain), plain.hasOwnProperty("x"), Object.keys(plain).join());

const list = [1, 2];
list.push = () => "own push";
list.extra = 3;
lines.push(list.push(9), list.length, list.extra);

class Stack extends Array {
  push(...items) { return super.push(...items.map(item => item * 2)); }
}
Stack.prototype.peek = function () { return this[this.length - 1]; };
const stack = new Stack();
stack.push(1, 2);
lines.push(stack.join(), stack.peek(), stack instanceof Array);

function Legacy() {}
Legacy.prototype = Object.create(Array.prototype);
Legacy.prototype.constructor = Legacy;
Legacy.prototype.push = function () { return "legacy push"; };
lines.push(new Legacy().push(), new Legacy().constructor === Legacy, Array.prototype.constructor === Array);

class Later extends Promise {
  then(resolved, rejected) { lines.push("own then"); return super.then(resolved, rejected); }
}
Later.resolve = function (value) { return new Later(resolve => resolve(value + 1)); };
lines.push(Object.hasOwn(Later, "resolve"), Promise.resolve === Later.resolve);

function* count() { yield 1; yield 2; }
count.prototype.next = function () { return { done: true, value: "own next" }; };
const counting = count();
lines.push(counting.next().value, [...counting].length);
const iterator = [7, 8][Symbol.iterator]();
iterator.next = () => ({ done: true, value: undefined });
lines.push([...iterator].length);

const receiver = {};
lines.push(Reflect.set(Array.prototype, "push", "for the receiver", receiver), receiver.push, typeof Array.prototype.push);
lines.push(await Later.resolve(1));
console.log(lines.join("\n"));
