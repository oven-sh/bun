// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
const mine = () => "mine";
console.log(JSON.parse("0", () => Reflect.set)(buffer, "atob", mine));
function use() {
  return buffer.atob("YQ==");
}
console.log(use(), buffer.atob === mine);
