// Stack frames of functions called through an await.
function inner() {
  throw new Error("inside");
}
function frames(error) {
  return String(error?.stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 3)
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
  [key]: async function () {
    return inner();
  },
}[key];
await show("an async function under a computed key:", waits);
const written = {
  written: async function () {
    return inner();
  },
}.written;
await show("an async function under a written key:", written);
const setter = Object.getOwnPropertyDescriptor(
  {
    set [key](value) {
      inner();
    },
  },
  key,
).set;
await show("a setter under a computed key:", setter);
Object.defineProperty(setter, "name", { value: "again" });
await show("the setter with a new name:", setter);
setter.displayName = "displayed";
await show("the setter with a displayName:", setter);
const list = [];
for (let n = 0; n < 4; n++) list.push(new Function("inner", "return function () { return inner(); }")(inner));
for (const [n, made] of list.entries()) Object.defineProperty(made, "name", { value: "again" + n });
await show("a function made from text with a new name, the first:", list[0]);
await show("a function made from text with a new name, the third:", list[2]);
