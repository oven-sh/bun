// A program deletes Map.prototype.getOrInsert and Set.prototype.union and puts functions of its own there before it first loads node:stream.
const seen = [];
seen.push(delete Map.prototype.getOrInsert, delete Set.prototype.union);
Map.prototype.getOrInsert = function () {
  seen.push("getOrInsert " + this.size);
};
Set.prototype.union = function () {
  seen.push("union " + this.size);
  return this.values();
};
require("node:stream");
console.log(seen.join(", "));
