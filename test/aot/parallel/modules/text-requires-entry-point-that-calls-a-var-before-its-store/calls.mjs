import { once } from "./helpers.mjs";
const a = once(() => 1),
  b = once(() => "b");
console.log("calls ends", a(), b());
