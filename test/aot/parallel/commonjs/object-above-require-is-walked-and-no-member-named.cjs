// The object right above `require` is walked, by its entries and by its keys, and the program names none of its members.
// Alone: what another program of the executable names decides what this one finds.
const above = Object.getPrototypeOf(require);
const kinds = [];
for (const [key, value] of Object.entries(above)) kinds.push(key + ":" + typeof value);
for (const key of Object.keys(above)) kinds.push(key + ":" + typeof above[key]);
console.log(kinds.join());
