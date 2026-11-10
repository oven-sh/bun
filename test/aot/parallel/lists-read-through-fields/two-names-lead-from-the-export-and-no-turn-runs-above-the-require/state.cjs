class Shelf { constructor(rows) { this.rows = rows; } }
class Depot { constructor(shelf) { this.shelf = shelf; } }
exports.depot = new Depot(new Shelf(JSON.parse("[1, 2, 3, 4.5]")));
