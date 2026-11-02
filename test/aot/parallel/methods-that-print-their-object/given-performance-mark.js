// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const mark = performance.mark("m", { startTime: 1 });
console.log(mark.name, mark.entryType);
console.log(Object.keys(JSON.parse(JSON.stringify(mark))).sort().join());
console.log(String(Bun.inspect(mark)).split("\n")[0]);
