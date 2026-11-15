class Shelf { constructor(rows) { this.rows = rows; } }
let shelf = process.argv.length > 90 ? undefined : new Shelf([1, 2, 3]);
Object.defineProperty(exports, "shelf", { enumerable: true, get: function () { return shelf; } });
