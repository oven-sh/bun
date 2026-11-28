import tallies from "./tallies.cjs";
import shelf from "./shelf.cjs";
import { weights } from "./names.mjs";

const show = value => (typeof value === "object" && value !== null ? "{" + Object.keys(value).join() + "}" : String(value));
console.log("direct", typeof tallies, show(tallies));
console.log("barrel", typeof shelf, show(shelf), shelf === tallies);
console.log("handed on", typeof weights, show(weights));
