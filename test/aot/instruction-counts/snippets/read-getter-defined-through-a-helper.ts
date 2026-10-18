// reads a getter that a helper function defined on a prototype with Object.defineProperty
const operations = 100;
function defineGetter(target: object, name: string, getter: () => unknown) {
  Object.defineProperty(target, name, { configurable: true, enumerable: true, get: getter });
}
const requestPrototype: any = {};
defineGetter(requestPrototype, "secure", function (this: any) {
  return this.scheme === "https";
});
defineGetter(requestPrototype, "weight", function (this: any) {
  return this.bytes + 1;
});
function request(scheme: string, bytes: number): any {
  const made = Object.create(requestPrototype);
  made.scheme = scheme;
  made.bytes = bytes;
  return made;
}
const requests = [request("http", 1), request("https", 2), request("http", 3), request("https", 4)];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += requests[i & 3].weight;
  total += sum;
}

console.log(total, requests[1].secure);
