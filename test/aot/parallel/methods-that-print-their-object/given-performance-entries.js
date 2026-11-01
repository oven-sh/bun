// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
performance.mark("a", { startTime: 1 });
console.log(String(Bun.inspect(performance.getEntriesByName("a"))).split("\n").slice(0, 2).join("|"));
