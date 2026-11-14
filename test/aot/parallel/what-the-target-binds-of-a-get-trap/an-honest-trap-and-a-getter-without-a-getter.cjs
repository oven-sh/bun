// The trap answers what the fixed member holds: that is allowed. A fixed accessor without a getter binds the trap to undefined.
Object.defineProperty(exports, "fixed", { value: "held", enumerable: true });
Object.defineProperty(exports, "onlySet", { set(value) {} });
const honest = new Proxy(exports, { get: (target, key) => target[key] });
const lying = new Proxy(exports, { get: () => "other" });
function read(proxy, name) {
  try {
    return String(name === "fixed" ? proxy.fixed : proxy.onlySet);
  } catch (error) {
    return error.name;
  }
}
for (let turn = 0; turn < 3; turn++)
  console.log(read(honest, "fixed"), read(honest, "onlySet"), read(lying, "fixed"), read(lying, "onlySet"));
