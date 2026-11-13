// The host asks the default export of the entry point for `fetch`, to find a server. A Proxy that throws at every name that its target does not have is no server, and the program goes on.
const refused = [];
module.exports = new Proxy(
  { a: 1 },
  {
    get(target, name, receiver) {
      if (name in target) return Reflect.get(target, name, receiver);
      refused.push(String(name));
      throw new Error("read of " + String(name));
    },
  },
);
setTimeout(() => console.log("tick", refused.join()), 1);
console.log("ran");
