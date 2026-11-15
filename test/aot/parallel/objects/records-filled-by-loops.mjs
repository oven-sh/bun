// Records get their members by loops over written names, and names beside them; functions copy what their arguments hold.
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
const lines = { count: 0 };
function write(level, text) {
  lines.count += level.length + text.length;
  return level + lines.count;
}
const logger = {};
for (const level of ["debug", "info", "warn"]) logger[level] = text => write(level, text);
const app = { settings: 1, routes: 0, route(method, path) { this.routes++; return method + path + this.settings; } };
["get", "post", "put", "settings"].forEach(function (method) {
  if (method !== "settings") app[method] = function (path) { return this.route(method, path); };
});
const table = { own: 1 };
table.late = 2;
["add", "sub"].forEach((name, at) => { table[name] = (a, b) => (at ? a - b : a + b); });
const kinds = {};
["A", "B"].forEach((name, at) => { kinds[name] = at; kinds[at] = name; });
const frozen = {};
for (const name of ["x", "y"]) frozen[name] = name + "0";
Object.freeze(frozen);
const guarded = { get x() { return "got"; }, set x(v) { this.kept = v; } };
for (const name of ["x", "y"]) guarded[name] = name + "1";
const holder = Object.create({ set z(v) { this.above = v; }, get z() { return "z" + this.above; } });
for (const name of ["z", "w"]) holder[name] = 5;
function extend(target) {
  for (let i = 1; i < arguments.length; i++) {
    const source = arguments[i];
    for (const name in source) target[name] = source[name];
  }
  return target;
}
function Model(v) { this.v = v; this.n = 0; }
const Events = { on(x) { this.n += x; return this; }, count() { return this.n; } };
extend(Model.prototype, Events, { get(x) { return this.v + x; } }, null, undefined, "text", 5, [7]);
function stored(target) {
  arguments[1] = { get: () => "stored" };
  for (let i = 1; i < arguments.length; i++) extend(target, arguments[i]);
  return target;
}
function back(target) {
  let text = "";
  for (let i = arguments.length; i >= 1; i--) text += attempt(() => arguments[i].n) + ",";
  return text + typeof target;
}
function run(turns, at, change) {
  let text = "";
  for (let i = 0; i < turns; i++) {
    if (i === at) attempt(change);
    const model = new Model(i);
    text += attempt(() => logger.info("a")) + attempt(() => logger.warn("bb")) + attempt(() => app.get("/")) + attempt(() => app.put("/p")) + attempt(() => table.add(i, 1)) + attempt(() => table.sub(i, 2));
    text += attempt(() => kinds.A + kinds.B + kinds[0]) + frozen.x + frozen.y + guarded.x + guarded.y + guarded.kept + holder.z + holder.w + table.late;
    text += attempt(() => model.on(i).count()) + attempt(() => model.get(1)) + " ";
  }
  return text;
}
console.log(run(6, -1, () => {}));
console.log(run(6, 3, () => { logger.info = text => "own" + text; delete logger.warn; app.put = undefined; }));
console.log(run(6, 2, () => { Object.defineProperty(table, "add", { get() { return () => "defined"; } }); kinds.A = "a"; }));
console.log(run(6, 2, () => { app.settings = 9; frozen.x = 1; delete Model.prototype.on; Model.prototype.get = () => "got"; }));
console.log(Object.keys(logger).join(), Object.keys(app).join(), Object.keys(table).join(), Object.keys(kinds).join(), JSON.stringify(guarded), JSON.stringify(holder));
console.log(attempt(() => stored({}, { get: () => "given" }).get()), attempt(() => stored({}).get()), back({}, { n: 1 }, { n: 2 }), back(), Object.keys(Model.prototype).join());
