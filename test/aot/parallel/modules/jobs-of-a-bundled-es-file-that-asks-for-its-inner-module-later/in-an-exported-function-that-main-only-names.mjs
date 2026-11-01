var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
export function named() {
  return require_inner();
}
console.log("body: in an exported function that main only names");
Promise.resolve().then(() => console.log("job: in an exported function that main only names"));
