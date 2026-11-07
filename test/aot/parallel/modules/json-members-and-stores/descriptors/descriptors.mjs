import * as ns from "./data.json";
const held = ns;
console.log(
  JSON.stringify(Object.getOwnPropertyDescriptor(held, "a")),
  JSON.stringify(Object.getOwnPropertyDescriptor(held, "default") !== undefined),
  Reflect.ownKeys(held).map(String).join(),
);
