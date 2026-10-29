// globalThis takes a member from a copy and loses one under a key put together at run time, so `Function` may be anything. Four function objects are made from one text, each gets a name of its own, a built-in prints them, and each throws behind an await. Prints the frames.
Object.assign(globalThis, {
  sleepSeconds: seconds => Bun.sleepSync(seconds * 1000),
});
delete globalThis[["Broadcas", "tChannel"].join("")];
function inner() {
  throw new Error("inside");
}
function frames(error) {
  return String(error?.stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
}
async function show(label, made) {
  try {
    await made();
  } catch (error) {
    console.log(label, JSON.stringify(made.name), Bun.inspect(made), frames(error));
  }
}
const key = "name" + 7;
const waits = {
  [key]: async function () {},
}[key];
const written = {
  written: async function () {},
}.written;
const setter = Object.getOwnPropertyDescriptor(
  {
    set [key](value) {},
  },
  key,
).set;
console.log(waits.name, written.name, setter.name);
const list = [];
for (let n = 0; n < 4; n++) list.push(new Function("inner", "return function () { return inner(); }")(inner));
for (const [n, made] of list.entries()) Object.defineProperty(made, "name", { value: "again" + n });
for (const [n, made] of list.entries()) await show("number " + n, made);
