import * as box from "./box.mjs";
try {
  console.log(Object.isFrozen(Object.freeze(box)));
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(Object.isFrozen(box), box.value);
