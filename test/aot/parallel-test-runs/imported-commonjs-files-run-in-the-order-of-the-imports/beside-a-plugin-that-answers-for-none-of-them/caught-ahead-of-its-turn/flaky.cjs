const { caught } = module.constructor;
module.constructor.caught = !caught;
if (!caught) throw new Error("first run");
exports.x = "second run";
