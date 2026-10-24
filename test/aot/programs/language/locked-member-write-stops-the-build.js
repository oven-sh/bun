// Map.prototype stays extensible in a compiled program, and its members are locked. A store to one of them that every run reaches stops the build, like a store to an object that is locked entirely: language/locked-write-stops-the-build.
Map.prototype.get = function () { return "replaced"; };
console.log(new Map([[1, 2]]).get(1));
export {};
