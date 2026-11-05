// A function declared under a constant key in brackets takes the key as its name: what `name`, bind(), a spy and stack frames show of it.
import { spyOn } from "bun:test";

function nameOfCaller() {
  const frame = new Error("x").stack.split("\n")[2];
  return frame.trim().replace(/ ?\(.*\)$/, "");
}

const holder = {
  ["method"]() {
    return "in " + nameOfCaller();
  },
  ["stored"]: function () {
    return "in " + nameOfCaller();
  },
  ["arrow"]: () => {
    return "in " + nameOfCaller();
  },
  get ["getter"]() {
    return "in " + nameOfCaller();
  },
  async ["waits"]() {
    await null;
    return "in " + nameOfCaller();
  },
};
class Holder {
  ["method"]() {
    return "in " + nameOfCaller();
  }
  static ["fixed"]() {
    return "in " + nameOfCaller();
  }
}

const functions = [holder.method, holder.stored, holder.arrow, holder.waits, new Holder().method, Holder.fixed];
console.log(JSON.stringify(functions.map(it => it.name)));
console.log(JSON.stringify(functions.map(it => it.bind(null).name)));
const names = [
  holder.method(),
  holder.stored(),
  holder.arrow(),
  holder.getter,
  await holder.waits(),
  new Holder().method(),
  Holder.fixed(),
];
console.log(names.join(" | "));
const spy = spyOn(holder, "method");
console.log(JSON.stringify([spy.getMockName(), spy.name]));
/* Output:
["method","stored","arrow","waits","method","fixed"]
["bound method","bound stored","bound arrow","bound waits","bound method","bound fixed"]
in at method | in at stored | in at arrow | in at get getter | in at waits | in at method | in at fixed
["method","method"]
*/
