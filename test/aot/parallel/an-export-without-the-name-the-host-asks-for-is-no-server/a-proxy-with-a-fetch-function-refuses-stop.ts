// Behind a `fetch` that is a function the host asks for `stop`, which a server that already runs has. A Proxy that throws at that name is no server either, and the program goes on.
const refused: string[] = [];
(Bun as any).serve = () => {
  throw new Error("Bun.serve() is called");
};
export default new Proxy(
  { fetch() {} },
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
