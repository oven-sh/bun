let half;
const get = () => half || (half = require("./half.cjs"));
const call = () => { try { return get()(7); } catch (e) { return e.name; } };
exports.first = call();
exports.again = () => { half = null; return call(); };
