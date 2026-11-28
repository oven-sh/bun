import { read as cjs } from "./imported.cjs";
import { read as mjs } from "./imported.mjs";
export default when => console.log(when, cjs(), mjs(), require("./required.cjs").read());
