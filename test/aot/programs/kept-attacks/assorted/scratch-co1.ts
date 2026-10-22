// Assorted, one probe of many. It prints what plain Bun prints.
import { Console } from "node:console";
try {
  new Console(process.stdout).log({ a: 1 }, "text", 5);
} catch (error) {
  console.log("threw", String(error), (error as Error).stack?.split("\n").slice(0, 4).join(" | "));
}
