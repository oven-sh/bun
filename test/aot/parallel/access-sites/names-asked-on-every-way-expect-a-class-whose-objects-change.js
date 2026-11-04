// By `width` and `height` the function expects a Box. The boxes that come have lost a field, have an accessor in its place, are frozen, or have another object above them.
// Under: --aot-testing=CheckProofsAtRunTime: nothing is proven here, an expectation is tested where it is used
class Box { constructor(width, height) { this.width = width; this.height = height; } }
function tagged(o) { const a = o.width * o.height; o.tag = a; return a; }
const lines = [];
function attempt(label, box) { try { lines.push(label + " " + tagged(box) + " " + Object.keys(box).join() + " " + box.tag); } catch (error) { lines.push(label + " " + error.constructor.name); } }
const boxes = JSON.parse("[1,2,3,4,5,6,7]").map(n => new Box(n, n + 1));
attempt("as made", boxes[0]);
delete boxes[1].height;
attempt("without a field", boxes[1]);
Object.defineProperty(boxes[2], "width", { get() { lines.push("getter"); return 10; } });
attempt("with a getter", boxes[2]);
attempt("frozen", Object.freeze(boxes[3]));
Object.setPrototypeOf(boxes[4], { set tag(value) { lines.push("setter above " + value); } });
attempt("below a setter", boxes[4]);
Object.preventExtensions(boxes[5]);
attempt("takes no more", boxes[5]);
Box.prototype.height = "above";
delete boxes[6].height;
attempt("field found above", boxes[6]);
attempt("as made", new Box(2, 3));
console.log(lines.join("\n"));
