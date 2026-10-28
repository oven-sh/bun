var original = module;
var i = 0;
while (i < 2) { module = i; i++; }
console.log("module after while:", module, typeof original.exports);
for (module of ["first", "second"]) console.log("module in for-of:", module);
console.log("module after for-of:", module);
