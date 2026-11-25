class Shelf { constructor(rows) { this.rows = rows; } }
export let shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4]"));
const second = new Shelf([10, 20, 30, 40, 50, 60]);
export const hooks = { swap(place) { if (place === 2) shelf = second; } };
