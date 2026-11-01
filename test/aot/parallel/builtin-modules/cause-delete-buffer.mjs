import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete new Error("e", { cause: buffer }).cause.btoa;
console.log(typeof buffer.btoa, tell(() => buffer.btoa("a")));
