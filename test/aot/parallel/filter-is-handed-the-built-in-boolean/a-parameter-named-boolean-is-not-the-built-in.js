function keep(list, Boolean) { return list.filter(Boolean); }
const mixed = JSON.parse('[0,1,2,3]');
console.log(JSON.stringify(keep(mixed, x => x > 1)), JSON.stringify(keep(mixed, globalThis.Boolean)));
