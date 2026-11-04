performance.mark("a", { startTime: 1 });
console.log(String(Bun.inspect(performance.getEntriesByName("a"))).split("\n").slice(0, 2).join("|"));
