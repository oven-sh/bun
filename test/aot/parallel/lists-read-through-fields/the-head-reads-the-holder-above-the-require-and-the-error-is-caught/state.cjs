class Shelf { constructor(rows) { this.rows = rows; } }
const shelf = new Shelf(JSON.parse("[1, 2, 3, 4.5]"));
exports.shelf = shelf;
