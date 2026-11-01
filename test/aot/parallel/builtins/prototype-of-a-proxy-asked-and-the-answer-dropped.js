// A handler that has the trap is asked, whether or not anybody uses the answer.
Object.getPrototypeOf(new Proxy({}, { getPrototypeOf(target) { console.log("asked by Object.getPrototypeOf"); return Reflect.getPrototypeOf(target); } }));
Reflect.getPrototypeOf(new Proxy({}, { getPrototypeOf(target) { console.log("asked by Reflect.getPrototypeOf"); return Reflect.getPrototypeOf(target); } }));
new Proxy({}, { getPrototypeOf(target) { console.log("asked by the accessor"); return Reflect.getPrototypeOf(target); } }).__proto__;
