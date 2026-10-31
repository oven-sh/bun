// Error stands above the constructor of an error that the run time threw. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const limit = Error.stackTraceLimit; Error.captureStackTrace({});
try { null.x; } catch (error) { console.log(limit, namesBehindCopy(Object.getPrototypeOf(error.constructor))); }
