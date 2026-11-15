class Shelf { constructor(rows) { this.rows = rows; } }
exports.shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3,4.5]"));
