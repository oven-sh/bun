const hooks = process.getBuiltinModule("node:perf_hooks");
const make = hooks[["create", "Histogram"].join("")];
const h = make();
h.record(3);
const box = new Map([["h", h]]);
console.log(require("node:util").inspect(box.get(process.argv[5] ?? "h")));
