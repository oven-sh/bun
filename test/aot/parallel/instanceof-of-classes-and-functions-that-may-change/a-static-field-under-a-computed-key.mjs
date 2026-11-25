const key = [Symbol.hasInstance][0];
class Odd { static [key] = value => value % 2 === 1; }
globalThis.kept = Odd;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Odd) hits += 1 << i; return hits; }
console.log(count([1, 2, 3, 4, new Odd()]));
