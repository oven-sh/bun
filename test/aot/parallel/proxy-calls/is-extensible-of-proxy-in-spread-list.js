const p = new Proxy(
  {},
  {
    isExtensible(t) {
      console.log("the trap runs");
      return Reflect.isExtensible(t);
    },
  },
);
console.log(Object.isExtensible(...[p]));
