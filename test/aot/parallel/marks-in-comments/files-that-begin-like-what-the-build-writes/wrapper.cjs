this.run=function(bindings\u0024){ var local = 1; function inner() {} return [typeof bindings$, typeof arguments, typeof module, new Error().stack.match(/:(\d+:\d+)\)?\n/)[1]].join();
};this.names="";
console.log(exports.run(1), JSON.stringify(exports.names), typeof local, typeof inner, "local" in globalThis);
