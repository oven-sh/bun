import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
class Odd extends Array {
  static get [Symbol.species]() {
    return function () {
      return types;
    };
  }
}
Object.setPrototypeOf(new Odd().filter(Boolean), { extra: () => "mine" });
console.log(typeof types.extra, tell(() => types.extra()));
