// Objects of built-in classes, and of classes below them, are stored in an object nobody knows, which is converted and written out beside them. No code nobody knows runs. Each still finds what stands above it.
const box = globalThis[process.argv[9] ?? "noSuchBox"] ?? {};
class List extends Array {
  tag = 1;
}
class Failure extends Error {
  get name() {
    return "Failure";
  }
}
const list = new List();
list.push(1, "two", [3, 4], null);
const values = [list, new Error("lost"), new Failure("mine"), new Map([[1, 2]]), new Set([1]), /a+b/giu, new Date(0), Promise.resolve(1), [1, [2, [3]]], { held: 1 }, new Uint8Array([1, 2])];
for (let index = 0; index < values.length; index++) box["held" + index] = values[index];
box.error = values[1];
box.pattern = values[5];
box.map = values[3];
process.stdout.write(`${box}\n`);
for (const value of values) {
  process.stdout.write(`${value}`.replace(/\(.*\)/, "") + "\n");
  process.stdout.write(JSON.stringify(value) + "\n");
}
process.stdout.write(JSON.stringify(Object.keys(box).length) + "\n");
