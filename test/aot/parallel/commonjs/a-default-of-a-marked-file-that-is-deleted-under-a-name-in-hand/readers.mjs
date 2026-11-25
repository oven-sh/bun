import emptied from "./emptied.cjs";
import handed from "./handed.cjs";
import rooms from "./rooms.cjs";
import shelf from "./shelf.cjs";
import tallies from "./tallies.cjs";
import untouched from "./untouched.cjs";
import { weights } from "./names.mjs";

const show = value => (typeof value === "object" && value !== null ? "{" + Object.keys(value).join() + "}" : String(value));
console.log(show(tallies), show(rooms), show(weights), show(shelf), show(handed), show(emptied), show(untouched));
try {
  console.log(rooms());
} catch (error) {
  console.log(error.name);
}
