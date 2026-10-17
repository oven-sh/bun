// The package's declaration file is wrong about what these members hold. Reading them through `!` does not turn the declared types into checks.
import { find, holder } from "./package.js";

const found = find("a");
console.log("a method", String(find("a")!.pair()));
console.log("a method of a variable", String(found!.pair()));
console.log("a property", String(find("a")!.size));
console.log("a property of a property", String(holder.inner!.size), String(holder.inner!.pair()));
console.log("kept", typeof found!.count(), String(found!.count()));
const right = find("right")!.pair();
console.log("where the declaration is right", right.length, right[0] instanceof Uint8Array);
try {
  find("nothing")!.pair();
} catch (error) {
  console.log("nothing there", error instanceof TypeError);
}
