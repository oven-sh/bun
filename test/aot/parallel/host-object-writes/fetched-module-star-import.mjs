// Alone: the stores of other programs would be seen beside its own
import * as ns from "node:buffer";
import buffer from "node:buffer";
const mine = () => "mine";
JSON.parse("0", () => process.getBuiltinModule)("node:buffer").atob = mine;
console.log(buffer.atob === mine, ns.atob === mine, ns.default.atob === mine);
