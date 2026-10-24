// The name is inherited from an object of the program, which is taken from above the object before the read.
const above = { constructor: 1, valueOf: 2 };
function afterChange(o) {
  const found = [];
  for (const name in o) {
    Object.setPrototypeOf(o, Object.prototype);
    found.push(name, typeof o[name], o[name] === Object);
  }
  return found.join();
}
console.log(afterChange(Object.create(above)));
const viaProto = { __proto__: above };
function afterProtoStore(o) {
  const found = [];
  for (const name in o) {
    o.__proto__ = Object.prototype;
    found.push(name, typeof o[name], o[name] === Object);
  }
  return found.join();
}
console.log(afterProtoStore(viaProto));
