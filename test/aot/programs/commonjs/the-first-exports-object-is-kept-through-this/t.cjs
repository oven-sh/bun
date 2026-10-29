const old = this;
module.exports = { name: "new", old, same: old === exports };
old.x = 1;
