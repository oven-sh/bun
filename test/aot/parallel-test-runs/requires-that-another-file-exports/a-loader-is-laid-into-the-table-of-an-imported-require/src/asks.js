import { load } from "./maker.js";
export const again = () => {
  load.extensions[".made"] = (module, path) => { module.exports = "by the table " + path.slice(-9); };
  return load("./note.made");
};
