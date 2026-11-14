// The host asks an entry point that awaits when the rest of it has run. A Proxy that throws at every name that its target does not have is no server there either, and the program goes on.
const refused: string[] = [];
export default new Proxy(
  { a: 1 },
  {
    get(target, name, receiver) {
      if (name in target) return Reflect.get(target, name, receiver);
      refused.push(String(name));
      throw new Error("read of " + String(name));
    },
  },
);
console.log("ran", refused.join());
await new Promise(resolve => setTimeout(resolve, 1));
setTimeout(() => console.log("tick", refused.join()), 1);
console.log("went on", refused.join());
