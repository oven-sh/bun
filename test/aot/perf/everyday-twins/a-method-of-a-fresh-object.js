// A method that a rare arm calls is laid by a statement that does not run: the calls that every iteration makes take no longer for it.
const data = JSON.parse("[0, 1]");
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
function Place(x, y) { this.x = x; this.y = y; }
Place.prototype.sum = function () { return this.x + this.y; };
if (data[0]) Place.prototype.debug = function () { return 0; };
export const loops = {
  "a method": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const point = new Point(i & 1023, 2); s += point.sum() + point.x; } return s; },
  "a method, and another in a rare arm": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const place = new Place(i & 1023, 2); s += place.sum() + place.x; if (data[0]) s += place.debug(); } return s; },
};
