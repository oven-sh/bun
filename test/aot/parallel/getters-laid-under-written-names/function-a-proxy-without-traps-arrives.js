// A getter laid under a written name on function, read by name in a function that runs often: a proxy without traps arrives.
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","freeze":"freeze","area":"area","create":"create"}');
const objects = Object;
function often(read) { let last; for (let i = 0; i < 400; i++) last = read(); return String(last); }
function log(...parts) { console.log(parts.join(" | ")); }
function make(width, height) {
  function made() { return made.area; }
  made.width = width; made.height = height;
  Object.defineProperty(made, "area", { enumerable: true, configurable: true, get: () => made.width * made.height + width, set: value => { width = value; } });
  Object.defineProperty(made, "rim", { configurable: true, get: () => 2 * (made.width + made.height) });
  return made;
}
let holder = make(3, 4);
function area() { return holder.area; }
function rim() { return holder.rim; }
log("before", often(area), often(rim));
holder = new Proxy(holder, {});
log("behind", area(), often(area), rim(), often(rim));
