// A class is exported whole and a static method is replaced.
const C = require("./c.cjs");
console.log(new C().x, C.make().x, C.count, C.Sub.name, new C.Sub() instanceof C);
C.make = () => ({ x: "replaced" }); console.log(C.make().x, C.viaSelf().x);
