// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
const mine = () => "mine";
Object.assign(
  JSON.parse("0", () => buffer),
  { atob: mine },
);
function use() {
  return buffer.atob("YQ==");
}
console.log(use(), buffer.atob === mine);
