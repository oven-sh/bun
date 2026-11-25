module.exports = function read(box) {
  return box.get("b");
};
if (!module.parent) console.log("started");
