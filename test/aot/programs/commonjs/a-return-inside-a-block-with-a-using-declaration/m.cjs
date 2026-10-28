{
  using r = { [Symbol.dispose]() { exports.c = "disposed " + exports.b; } };
  exports.a = 1;
  if (Date.now() > 0) return;
  exports.b = 2;
}
