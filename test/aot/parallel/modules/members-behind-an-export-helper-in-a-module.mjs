// The same in a module, where the object is exported and the functions of the top are called before it is filled.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
const out = [], t = f => { try { return String(f()); } catch (e) { return e.name; } };
out.push(t(() => peek()));
function peek() { return z_exports.string().kind; }
let z_exports = {};
__export(z_exports, { string: () => string, default: () => z_default, size: () => size, self: () => z_exports });
out.push(t(() => z_exports.size), t(() => z_exports.string().kind));
class Type { constructor(kind) { this.kind = kind; } optional() { return new Type(this.kind + "?"); } }
const string = () => new Type("string"); let size = 1; var z_default = z_exports;
const run = (z, n) => { let s = 0; for (let i = 0; i < n; i++) s += z.string().optional().kind.length + z_exports.string().kind.length + z_exports.size + z_exports.self.size; return s; };
out.push(run(z_exports, 5)); size = 10; out.push(run(z_default, 5), z_exports.default === z_exports, z_exports.self.default.size, peek());
async function later() { await null; size++; return z_exports.size; } function* steps() { yield z_exports.size; size = 0; yield z_exports.size; }
out.push(await later(), [...steps()].join(), [1, 2].map(z_exports.string).length, `${z_exports.size}`, t(() => z_exports.none.x), t(() => { z_exports.size = 5; }), Reflect.ownKeys(z_exports).join());
export { z_exports as z, z_default as default };
console.log(out.join(" "));
