// An untyped package and a program of it (errors): hierarchies over built-ins: arrays that know their kind, maps with defaults, errors with causes, promises, typed arrays, functions that are classes
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const make = [() => new lib.AppError('plain'), () => new lib.NotFound('thing'), () => new lib.Timeout('job', { cause: new RangeError('inner') }), () => lib.NotFound.wrap(new TypeError('t'), 'wrapped'), () => lib.AppError.wrap(new lib.Timeout('x'), 'kept'), () => new lib.AppError('c', { code: 0, cause: new lib.NotFound('deep', { cause: new Error('root') }) })]; for (let i = 0; i < 12; i++) { let e; try { throw make[i % 6](); } catch (x) { e = x; } if (i === 6) lib.NotFound.code = 'CHANGED'; if (i === 8) lib.AppError.prototype.extra = 'late'; say(i, e.name, e.message, e.code, e.chain, e instanceof lib.NotFound, e instanceof Error, JSON.stringify(e), String(e), Object.keys(e).join(), e.extra, e.stack.split('\n')[0], Object.prototype.toString.call(e)); }
