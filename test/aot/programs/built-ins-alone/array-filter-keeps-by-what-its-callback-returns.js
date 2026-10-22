const kept = [1.5, "two", { three: 3 }].filter(value => (typeof value === "object" ? value : ""));
console.log(kept.length, kept[0].three + 1);
