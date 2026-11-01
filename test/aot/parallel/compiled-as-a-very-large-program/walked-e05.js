// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, in a function that a very large program ranks cold. One of 22 forms; walked-key.js says what went wrong.
function r72make() { return { p: "start", n: 0, a: 1, b: 2, c: 3 }; }
function r72f(x, n) {
  x.a = (x.a * 3 + n) % 1009; x.b = (x.b ^ (x.a << 1)) & 65535; if (x.b > 60000) x.c += 1;
  x.a = (x.a * 4 + n) % 1011; x.b = (x.b ^ (x.a << 2)) & 65535; if (x.b > 59999) x.c += 2;
  x.a = (x.a * 5 + n) % 1013; x.b = (x.b ^ (x.a << 3)) & 65535; if (x.b > 59998) x.c += 3;
  x.a = (x.a * 6 + n) % 1015; x.b = (x.b ^ (x.a << 4)) & 65535; if (x.b > 59997) x.c += 4;
  x.a = (x.a * 7 + n) % 1017; x.b = (x.b ^ (x.a << 5)) & 65535; if (x.b > 59996) x.c += 5;
  x.a = (x.a * 8 + n) % 1019; x.b = (x.b ^ (x.a << 1)) & 65535; if (x.b > 59995) x.c += 6;
  x.a = (x.a * 9 + n) % 1021; x.b = (x.b ^ (x.a << 2)) & 65535; if (x.b > 59994) x.c += 7;
  x.a = (x.a * 10 + n) % 1023; x.b = (x.b ^ (x.a << 3)) & 65535; if (x.b > 59993) x.c += 8;
  x.a = (x.a * 11 + n) % 1025; x.b = (x.b ^ (x.a << 4)) & 65535; if (x.b > 59992) x.c += 9;
  x.a = (x.a * 12 + n) % 1027; x.b = (x.b ^ (x.a << 5)) & 65535; if (x.b > 59991) x.c += 10;
  x.a = (x.a * 13 + n) % 1029; x.b = (x.b ^ (x.a << 1)) & 65535; if (x.b > 59990) x.c += 11;
  x.a = (x.a * 14 + n) % 1031; x.b = (x.b ^ (x.a << 2)) & 65535; if (x.b > 59989) x.c += 12;
  x.a = (x.a * 15 + n) % 1033; x.b = (x.b ^ (x.a << 3)) & 65535; if (x.b > 59988) x.c += 13;
  x.a = (x.a * 16 + n) % 1035; x.b = (x.b ^ (x.a << 4)) & 65535; if (x.b > 59987) x.c += 14;
  for (x.p in { worda: 1 }) { x.n += n; }
  return x.n; }
const r72a = r72make(); let r72out = "";
r72out += r72f(r72a, 1) + ";";
r72out += r72f(r72a, 4) + ";";
console.log("R=" + r72out + r72a.p);
