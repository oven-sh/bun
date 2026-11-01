// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
const mine = () => "mine";
JSON.parse("0", () => Object.defineProperty)(buffer, "btoa", { value: mine });
function use() {
  return buffer.btoa("a");
}
console.log(use(), buffer.btoa === mine);
