module.exports = create;
module.exports.version = 1;
module.exports.add = (a, b) => a + b;
module.exports.twiceVersion = () => module.exports.version * 2;
module.exports.readVersion = () => create.version;
function create() {
  return "created";
}
