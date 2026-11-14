import { mark } from "./quiet-box/loud.mjs";
function used() {
  const neverCalled = () => mark();
  return "main ran";
}
console.log(used());
