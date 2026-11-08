const first = new Map(); for (let i = 0; i < 40; i++) first.set("K" + i, i * 2);
const map = new Map(first);
console.log(map.size, map.get("K7") + 1);
