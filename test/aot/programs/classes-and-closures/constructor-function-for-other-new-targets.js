function Point() { this.px = 1; this.py = 2; this.seen = typeof this.m === "function" ? this.m() : "none"; }
Point.prototype.m = function () { return "Point.m"; };
class U { m() { return "U.m"; } }
function G() {}
G.prototype.m = function () { return "G.m"; };
function H() {}
H.prototype = { m() { return "H.m"; } };
function read(o) { return o.extra + " " + o.px + " " + o.py + " " + o.seen + " " + (typeof o.m === "function" ? o.m() : "none") + " " + (o instanceof Point) + " " + Object.keys(o).join(); }
const list = [new Point(), Reflect.construct(Point, [], U), Reflect.construct(Point, [], G), Reflect.construct(Point, [], H), Reflect.construct(Point, [], Point.bind(null)), Reflect.construct(Point, [], new Proxy(U, {})), Reflect.construct(Point, [], Object)];
for (let i = 1; i < list.length; i++) list[i].extra = i;
for (let i = 0; i < list.length; i++) console.log(read(list[i]));
for (let i = 1; i < list.length; i++) delete list[i].px;
for (let i = 0; i < list.length; i++) console.log(read(list[i]));
