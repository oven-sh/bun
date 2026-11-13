// A getter laid under a written name on object below null, read by name in a function that runs often: nothing is done.
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","freeze":"freeze","area":"area","create":"create"}');
const objects = Object;
function often(read) { let last; for (let i = 0; i < 400; i++) last = read(); return String(last); }
function log(...parts) { console.log(parts.join(" | ")); }
function make(width, height) {
  const made = Object.create(null);
  made.width = width; made.height = height;
  Object.defineProperty(made, "area", { get: function () { return this.width * this.height + width; }, enumerable: true, configurable: true });
  Object.defineProperty(made, "rim", { get: function () { return 2 * (this.width + this.height); }, enumerable: true, configurable: true });
  return made;
}
let holder = make(3, 4);
function area() { return holder.area; }
function rim() { return holder.rim; }
log("before", often(area), often(rim));
log("behind", area(), often(area), rim(), often(rim));
