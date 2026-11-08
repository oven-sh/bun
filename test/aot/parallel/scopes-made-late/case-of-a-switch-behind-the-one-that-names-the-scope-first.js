function choose(kind, keep) { switch (kind) { case 0: { return "none"; } case 1: const first = "first"; keep(() => first); return first; case 2: const second = "second"; keep(() => second); return second; } return "other"; }
const kept = []; console.log(choose(2, f => kept.push(f)), choose(1, f => kept.push(f)), choose(0), choose(3), kept.map(f => f()).join());
