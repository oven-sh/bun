// real.cjs runs while the statements are followed, and the build does not know what its require may name.
import { load } from "./real.cjs";
import "./middle.mjs";
const again = () => require("./middle.mjs");
console.log(globalThis.seen.join(" "), typeof again, typeof load);
