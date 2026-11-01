// Alone: the stores of other programs would be seen beside its own
import buffer, { atob as named } from "node:buffer";
const mine = () => "mine";
JSON.parse("0", () => process.getBuiltinModule)("node:buffer").atob = mine;
console.log(buffer.atob === mine, named === mine);
