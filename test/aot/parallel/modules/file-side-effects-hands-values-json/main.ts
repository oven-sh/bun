// The package lists the files that have side effects. Each of them hands on a value of a JSON file, and comes to the program through a file that the list does not name.
import { version } from "./barrel-by-name";
import { name } from "./barrel-by-star";
import { settings } from "./barrel-whole";
import { version as behindTwo } from "./barrel-outer";
import { limits } from "./barrel-in-a-function";

const ran: string[] = ((globalThis as any).ran ??= []);
function readLimits() {
  return limits.retries;
}
console.log(version, name, settings.port, settings.nested.depth, behindTwo, readLimits());
console.log(ran.join(" "));
