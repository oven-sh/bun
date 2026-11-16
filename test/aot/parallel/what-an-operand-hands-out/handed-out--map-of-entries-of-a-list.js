const list = []; for (let i = 0; i < 40; i++) list.push({ id: i });
const map = new Map(list.entries());
let t = 0; map.forEach((value, key) => { t += key + value.id; });
console.log(map.size, t, map.get(7).id);
