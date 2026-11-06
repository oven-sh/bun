// A link reads both names that the statement imports from "node:process", in the order of the statement, though only the second is used.
import { uptime, hrtime } from "node:process";
const held = [process.cwd];
held.push(hrtime);
Object.entries(process); console.log(Reflect.ownKeys(process).slice(4, 12).join());
