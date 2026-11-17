class Shelf { constructor(rows) { this.rows = rows; } }
exports.fill = function (text) { exports.shelf = new Shelf(JSON.parse(text)); };
exports.empty = function () { exports.shelf = undefined; };
