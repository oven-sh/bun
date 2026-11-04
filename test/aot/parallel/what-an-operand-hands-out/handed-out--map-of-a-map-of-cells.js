const first = new Map(); for (let i = 0; i < 40; i++) first.set({ id: i }, [i, "t" + i]);
const map = new Map(first);
let t = 0; map.forEach((value, key) => { t += key.id + value[0] + value[1].length; });
console.log(map.size, t);
