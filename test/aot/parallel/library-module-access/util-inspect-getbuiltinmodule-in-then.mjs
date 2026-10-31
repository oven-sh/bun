// One name of node:util is imported and used. Another, inspect, is found through process.getBuiltinModule, handed to then, under a name that is put together at run time.
import { format } from "node:util";
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["ins", "pect"].join("");
const name = ["node:", "util"].join("");
const whole = await Promise.resolve(name).then(process.getBuiltinModule);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
