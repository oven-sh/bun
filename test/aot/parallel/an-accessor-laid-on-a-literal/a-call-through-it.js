const log = []; const holder = { get lazy() { log.push("got"); return () => 9; } };
console.log(holder.lazy(), log.join());
