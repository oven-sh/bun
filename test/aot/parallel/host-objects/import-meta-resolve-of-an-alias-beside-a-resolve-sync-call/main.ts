// import.meta.resolve of a name that the build chose among and that only the tsconfig explains answers the file, also in a module that calls import.meta.resolveSync.
import { o } from "@lib/other";
import { w } from "@lib/thing";

const tail = (ask: () => string) => {
  try {
    return ask().split("/").slice(-2).join("/");
  } catch (error: any) {
    return error.constructor.name + ": " + error.message.replace(/ imported from .*/, "");
  }
};
const names = process.argv.length > 5 ? ["./lib/thing.ts"] : ["@lib/thing", "@lib/other"];

console.log(w + o);
for (const name of names) console.log(name, tail(() => import.meta.resolve(name)));
console.log(tail(() => import.meta.resolveSync("./lib/thing.ts")));
