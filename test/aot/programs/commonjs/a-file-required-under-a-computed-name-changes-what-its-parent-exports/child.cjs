try {
  module.parent.exports.limit = 7;
  module.parent.exports.bump(3);
} catch (error) {
  console.log("threw", error.constructor.name);
}
