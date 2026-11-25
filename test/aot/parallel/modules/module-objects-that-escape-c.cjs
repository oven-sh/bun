// A file that nobody required calls what it hands out, which applies what it is handed.
module.exports = function run(action) {
  return action.apply(null, [2, 3]);
};
if (!module.parent) console.log(module.exports((a, b) => a * b), module.exports({ apply: (holder, list) => list.length }));
