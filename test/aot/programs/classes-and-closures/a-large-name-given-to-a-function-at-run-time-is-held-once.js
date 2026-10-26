// A function takes its name from a computed key, from a definition of `name`, or shows a `displayName`. The text is many times as large as everything else in the process, so what the process holds tells whether the text is there once more.
const size = 2 ** 28;
const key = "k".padEnd(size, "a");
const keyed = { [key]: 1 };
const before = process.memoryUsage().rss;
const grew = () => process.memoryUsage().rss - before > size / 2;

class Named {
  [key]() {}
}
console.log("a method of a class", Named.prototype[key].name.length, grew());

const literal = { [key]() {} };
console.log("a method of a literal", literal[key].name.length, grew());

function defined() {}
Object.defineProperty(defined, "name", { value: key });
console.log("a definition of the name", defined.name.length, grew());

function shown() {}
shown.displayName = key;
console.log("a displayName", shown.displayName.length, grew(), keyed[key]);
