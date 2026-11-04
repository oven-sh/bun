Object.freeze(Array.prototype);
const list = [1, 2];
list.join = 1; list.own = 2;
console.log(typeof list.join, list.own, list.join === 1 ? "stored" : list.join("-"));
