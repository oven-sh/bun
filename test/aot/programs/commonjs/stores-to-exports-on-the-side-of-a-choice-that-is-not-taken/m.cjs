let t = 1, f = 0, n = null;
t ||= (exports.a = 1);
f &&= (exports.b = 2);
t ??= (exports.c = 3);
t && f && (exports.d = 4);
f || t || (exports.e = 5);
t ? 0 : (exports.g = 6);
exports.z = 0;
