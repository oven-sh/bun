// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Thread } from "./kinds.mjs";
if (process.argv.length > 5) new Thread(process.argv[5], { eval: true });
console.log("none started");
