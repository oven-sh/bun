// An untyped package and a program of it (matrices errors): classes over Map, Array, Set and Error
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let m = lib.Matrix.identity(3); m[0][1] = 2; m[1][2] = 1; let p = m; for (let i = 0; i < 8; i++) { say(i, JSON.stringify(p), p.trace, p instanceof lib.Matrix, p.constructor.name); p = p.times(m); if (i === 4) m[2][0] = 0.5; }
for (const f of [() => new lib.HttpError(404), () => new lib.HttpError(400, 'nope', { code: 'E' }), () => new lib.ServerError(500, '', { retry: 3 }), () => lib.HttpError.from(new TypeError('tt')), () => lib.HttpError.from(new lib.ServerError(503, 'busy')), () => { try { null.x; } catch (e) { return lib.HttpError.from(e); } }]) { const e = f(); say(e.name, e.message, e.status, e.expose, e instanceof Error, e instanceof lib.ServerError, Object.keys(e).join(), String(e), e.stack.split('\n')[0].length > 2); }
