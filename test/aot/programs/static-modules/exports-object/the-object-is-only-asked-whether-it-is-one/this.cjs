exports.a = 1;
exports.log = [!this, this == null, this === undefined, this != null, this ? "object" : "nothing", typeof (this && 5)].join();
if (this) exports.b = 2;
this && (exports.c = 3);
