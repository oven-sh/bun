const names = (tag) => function self(asksForItself) {
  return asksForItself ? self : tag;
};

let bound = names("first").bind(null);
if (globalThis.process) bound = names("second").bind(null);

console.log(bound(false), bound(true) === bound, typeof bound(true), bound(true)(false));
