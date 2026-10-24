var x = 1;
module.exports = 0;
globalThis.there = 2;
console.log("delete a name: " + (delete x) + " " + (delete neverThere) + " " + (delete there) + " " + typeof there);
