// A function that takes a name and a rest parameter is called through a value that nobody follows. What that caller passes lies in the rest array, index by index.
const table = {};
function isText(name, ...rest) {
  table[name] = true;
  const first = rest[0];
  const value = first === undefined ? "none" : first;
  if (typeof value === "string") return "a text";
  return "no text";
}
function join(name, ...rest) {
  table[name] = true;
  const first = rest[0];
  const value = first === undefined ? "none" : first;
  return value + "!";
}
function lengthOf(name, ...rest) {
  table[name] = true;
  const second = rest[1];
  const value = second === undefined ? "none" : second;
  return value.length;
}
const handlers = {
  twice(value) {
    return value + value;
  },
};
function emit(type, ...args) {
  const first = args[0];
  return handlers[type](first === undefined ? "none" : first);
}

const list = new Proxy([], {});
list.push(isText, join, lengthOf, emit);
console.log(list[0]("k", 21), list[0]("k", "text"), list[0]("k"));
console.log(list[1]("k", 21), list[1]("k", "text"), list[1]("k"));
console.log(list[2]("k", 0, [1, 2, 3]), list[2]("k", 0, 21), list[2]("k", 0, "text"), list[2]("k"));
console.log(list[3]("twice", 21), list[3]("twice", "text"), list[3]("twice"));

const holder = new Proxy({ isText, join }, {});
console.log(holder.isText("k", {}), holder.join("k", null));
console.log(isText("k", "seen"), join("k", "seen"), lengthOf("k", 0, "seen"), emit("twice", "seen"));
