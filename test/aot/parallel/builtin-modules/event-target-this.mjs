import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const target = new EventTarget();
target.p = types;
target.addEventListener("go", function () {
  Object.setPrototypeOf(this.p, { extra: () => "mine" });
});
target.dispatchEvent(new Event("go"));
console.log(typeof types.extra, tell(() => types.extra()));
