import _typeof from "./typeof.mjs";
import toPrimitive from "./toPrimitive.mjs";
function toPropertyKey(t) {
  var i = toPrimitive(t, "string");
  return "symbol" == _typeof(i) ? i : i + "";
}
export { toPropertyKey as default };
