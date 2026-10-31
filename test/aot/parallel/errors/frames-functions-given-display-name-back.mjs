// Prints what the first stack frame calls each of two function objects of one function once one of them has been given a displayName through a value that came back out of code made at run time.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const kept = new Function("f", "if (f) this.kept = f; return this.kept;" + never).bind({});
const Holder = new Function("f", "this.held = f;" + never);
const forms = {
  "a call, a store": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => void (handedBack(f).displayName = "displayed"),
  ],
  "a call, a store to an arrow function": [
    () => {
      let made;
      made = () => new Error("x").stack;
      return made;
    },
    f => void (handedBack(f).displayName = "displayed"),
  ],
  "a call, a store to a method": [
    () =>
      ({
        made() {
          return new Error("x").stack;
        },
      }).made,
    f => void (handedBack(f).displayName = "displayed"),
  ],
  "a call, a store to an async function": [
    () =>
      async function made() {
        return new Error("x").stack;
      },
    f => void (handedBack(f).displayName = "displayed"),
  ],
  "a call, a store to a function that captures": [
    (n = 1) =>
      function made() {
        return new Error("x" + n).stack;
      },
    f => void (handedBack(f).displayName = "displayed"),
  ],
  "a call, a store under a key in brackets": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => void (handedBack(f)["displayName"] = "displayed"),
  ],
  "a call, Reflect.set": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => Reflect.set(handedBack(f), "displayName", "displayed"),
  ],
  "a call, Object.defineProperty": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => Object.defineProperty(handedBack(f), "displayName", { value: "displayed" }),
  ],
  "a call, Reflect.defineProperty": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => Reflect.defineProperty(handedBack(f), "displayName", { value: "displayed" }),
  ],
  "a call, Object.defineProperties": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => Object.defineProperties(handedBack(f), { displayName: { value: "displayed" } }),
  ],
  "a call, Object.assign": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => Object.assign(handedBack(f), { displayName: "displayed" }),
  ],
  "a call that keeps it, a store": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => {
      kept(f);
      kept().displayName = "displayed";
    },
  ],
  "a construction, a store": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => void (new Holder(f).held.displayName = "displayed"),
  ],
  "a list, a store": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => void (handedBack([f])[0].displayName = "displayed"),
  ],
  "a property of globalThis, a store": [
    () =>
      function made() {
        return new Error("x").stack;
      },
    f => {
      globalThis.road = f;
      handedBack(globalThis).road.displayName = "displayed";
    },
  ],
};
for (const [form, [make, give]] of Object.entries(forms)) {
  const given = make();
  const other = make();
  const before = firstFrame(await given());
  give(given);
  console.log(`${form} | ${before} | ${firstFrame(await given())} | ${firstFrame(await other())}`);
}
