// Function.prototype.toJSON defined as a getter with Object.defineProperty.
let reads = 0;
Object.defineProperty(Function.prototype, "toJSON", {
  get() {
    reads++;
    return () => "got";
  },
  configurable: true,
});
function named() {}
console.log(JSON.stringify({ named }), JSON.stringify([named, () => {}]), reads);
console.log(Object.keys(Function.prototype).length, typeof Object.getOwnPropertyDescriptor(Function.prototype, "toJSON").get);
