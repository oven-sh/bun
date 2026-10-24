const create = require("./create.cjs");
let made = 0;
exports.made = () => ++made;
exports.saw = [typeof create, create.name, create.early, create.late, typeof create.create, Object.keys(create).join()].join("|");
exports.later = () => [create.late, create.create === create, Object.keys(create).join(), create("x").made].join("|");
