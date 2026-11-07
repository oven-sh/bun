// An instance of a class that extends Map, whose cell is that of a map and has no shape of the program's, is laid below another object and asked whether it is an instance of its class and of Map.
class OwnMap extends Map { constructor() { super(); this.own = 1; } }
function isOwn(x) { return x instanceof OwnMap; }
function madeIsOwn(move) { const made = new OwnMap(); if (move) Object.setPrototypeOf(made, Map.prototype); return made instanceof OwnMap; }
function madeIsMap(move) { const made = new OwnMap(); if (move) Object.setPrototypeOf(made, null); return made instanceof Map; }

function deed(above) {
  const made = new OwnMap();
  Object.setPrototypeOf(made, above);
  return made;
}
console.log(String(isOwn(new OwnMap())), String(isOwn(new Map())), String(madeIsOwn(false)), String(madeIsOwn(true)), String(madeIsMap(false)), String(madeIsMap(true)));
console.log(String(isOwn(deed(Map.prototype))), String(isOwn(deed(null))), String(isOwn(deed(Object.create(OwnMap.prototype)))), String(deed(Map.prototype) instanceof Map));
let count = 0;
for (let i = 0; i < 200; i++) count += (madeIsOwn(i % 3 === 0) ? 1 : 0) + (madeIsMap(i % 5 === 0) ? 10 : 0) + (isOwn(i & 1 ? new OwnMap() : deed(null)) ? 100 : 0);
console.log(String(count));
