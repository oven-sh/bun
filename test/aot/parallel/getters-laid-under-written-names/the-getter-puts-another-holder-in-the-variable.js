// A getter laid under a written name, read by name in a function that runs often: the getter puts another holder in the variable.
const hidden = JSON.parse('{"define":"defineProperty","below":"setPrototypeOf","freeze":"freeze","area":"area","create":"create"}');
const objects = Object;
function often(read) { let last; for (let i = 0; i < 400; i++) last = read(); return String(last); }
function log(...parts) { console.log(parts.join(" | ")); }
function make(width) {
  const made = Object.create(null);
  Object.defineProperty(made, "area", { configurable: true, get: function () { if (width < 600) holder = make(width + 1); return width; } });
  Object.defineProperty(made, "rim", { configurable: true, get: function () { return -width; } });
  return made;
}
let holder = make(3);
function area() { try { const got = holder.area; return typeof got === "object" ? Object.prototype.toString.call(got) : got; } catch (error) { return error.constructor.name + ": " + error.message; } }
function rim() { const got = holder.rim; return typeof got === "object" ? Object.prototype.toString.call(got) : got; }
log("first", often(area), often(rim));
log("again", area(), often(area), rim(), often(rim));
