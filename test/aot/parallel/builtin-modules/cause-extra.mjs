import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
Object.setPrototypeOf(new Error("e", { cause: buffer }).cause, { extra: () => "mine" });
console.log(typeof buffer.extra, tell(() => buffer.extra()));
