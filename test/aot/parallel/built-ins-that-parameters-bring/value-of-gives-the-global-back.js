function g(o) { return o.valueOf; } console.log(g(globalThis).call(globalThis)[process.argv[2] ?? "Map"].name);
