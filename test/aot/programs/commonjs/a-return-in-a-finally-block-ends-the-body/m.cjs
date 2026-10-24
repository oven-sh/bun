exports.a = 1;
try { exports.c = 3; } finally { if (Date.now() > 0) return; }
exports.b = 2;
