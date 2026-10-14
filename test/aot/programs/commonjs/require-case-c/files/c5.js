const log = [];
const note = (s) => (log.push(s), s);
module.exports = { a: note("a"), b: note("b"), log };
