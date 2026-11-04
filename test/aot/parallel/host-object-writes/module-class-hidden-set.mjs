import buffer from "node:buffer";
const mine = function () {
  return { size: "mine" };
};
JSON.parse("0", () => Reflect.set)(buffer, "Blob", mine);
function use() {
  return new buffer.Blob(["a"]).size;
}
console.log(use(), buffer.Blob === mine);
