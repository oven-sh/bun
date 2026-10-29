// What a module of the library exports goes into a stream and comes back as a value that the compiler knows nothing about.
// Whoever copies or lists that value runs the getter on it, which loads another module.
var { require } = import.meta;
const timers = require("node:timers");
const handed = (
  await Array.fromAsync(
    new ReadableStream({
      start(controller) {
        controller.enqueue(timers);
        controller.close();
      },
    }),
  )
)[0];

const { ...rest } = handed;
console.log("a rest pattern", typeof rest.promises);

const { setTimeout: taken, ...others } = handed;
console.log("a rest pattern behind a name", typeof taken, typeof others.promises);

console.log("a rest pattern in a parameter", typeof (({ ...all }) => all)(handed).promises);

if (handed !== undefined && handed !== null) {
  console.log(
    "entries",
    Object.entries(handed)
      .map(([name, member]) => name + " " + typeof member)
      .sort()
      .join(),
  );
  console.log(
    "values",
    Object.values(handed)
      .map(member => typeof member)
      .sort()
      .join(),
  );
}

const kinds = [];
for (const name in handed) kinds.push(name + " " + typeof handed[name]);
console.log("for in", kinds.sort().join());

console.log("a key out of a text", typeof handed[JSON.parse('"promises"')]);
