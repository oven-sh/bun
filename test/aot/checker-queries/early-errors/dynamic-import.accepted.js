// import() with one or two arguments, with or without a trailing comma, and after new in parentheses or as an argument.
import("node:fs");
import("node:fs", {});
import("node:fs",);
var a; import(a);
new (import("node:fs"));
new (import("node:fs").then)();
class C {} new C(import("node:fs"));
