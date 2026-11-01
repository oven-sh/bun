import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const held = JSON.parse("0", () => buffer);
Object.setPrototypeOf(held, Array.prototype);
const ask = () => buffer instanceof Array;
console.log(String(ask()));
