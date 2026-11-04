const lib = await import("./re-exported-lib");
console.log(lib.add(1), lib.level, typeof lib.Counter, Object.keys(lib).sort().join());
