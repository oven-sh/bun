// A promise that is resolved with a FormData looks for `then`.
Object.defineProperty(FormData.prototype, "then", {
  configurable: true,
  get() {
    delete FormData.prototype.then;
    return resolve => resolve(new Map([["mine", 1]]));
  },
});
const settled = await new Response("a=1", {
  headers: { "content-type": "application/x-www-form-urlencoded" },
}).formData();
console.log(`${settled instanceof Map} ${settled instanceof FormData} ${settled.get("mine")} ${settled.get("a")}`);
