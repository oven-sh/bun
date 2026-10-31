var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
export const box = {
  get x() {
    return require_inner();
  },
};
console.log("body: in an exported getter that main reads later");
Promise.resolve().then(() => console.log("job: in an exported getter that main reads later"));
