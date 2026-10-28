out: { exports.a = 1; if (Date.now() > 0) break out; exports.b = 2; }
sw: switch (1) { case 1: exports.c = 3; break; case 2: exports.d = 4; }
lp: for (;;) { exports.e = 5; break lp; exports.f = 6; }
do { exports.g = 7; continue; exports.h = 8; } while (false);
