// A function takes its name from a computed key, from a definition of `name`, or shows a `displayName`. The text is as large as everything else in the process many times over, so what the process holds tells how often the text is there.
const size = 2 ** 28;
const held = () => Math.round(process.memoryUsage().rss / size);

const key = "k".padEnd(size, "a");
class Named {
  [key]() {}
}
console.log("a method of a class", Named.prototype[key].name.length, held());

const literal = { [key]() {}, [key + "!"]: 1 };
delete literal[key + "!"];
Bun.gc(true);
console.log("a method of a literal under the same key", literal[key].name.length, held());

function defined() {}
Object.defineProperty(defined, "name", { value: key });
console.log("the same text defined as a name", defined.name.length, held());

function shown() {}
shown.displayName = key;
console.log("the same text as a displayName", shown.displayName.length, held());
