// JavaScriptCore refuses some keywords that are written with escapes, and takes others.
const attempt = (name, f) => {
  try {
    console.log(name, typeof f());
  } catch (e) {
    console.log(name, e.name, e.message);
  }
};
attempt(1, () => eval("(function () { ({ l\\u0065t } = {}); return 1; })"));
attempt(2, () => new Function("x", "({ l\\u0065t } = {}); return function () {};"));
attempt(3, () => eval("(function (l\\u0065t) { return l\\u0065t; })"));
attempt(4, () => eval("(function () { var st\\u0061tic = 1; return { st\\u0061tic }; })"));
attempt(5, () => eval("(function () { ({ st\\u0061tic } = {}); })"));
attempt(6, () => eval("(function () { ({ \\u006fther } = {}); })"));
attempt(7, () => eval("(function () { for (var x \\u006ff []) ; })"));
attempt(8, () => eval("(function () { ({ g\\u0065t x() {} }); })"));
attempt(9, () => eval("(function () { return n\\u0065w.target; })"));
attempt(10, () => eval("(function () { return new.t\\u0061rget; })"));
attempt(11, () => eval("(function () { l\\u0065t: for (;;) break l\\u0065t; })"));
attempt(12, () => eval("(function (a, b) { return \\u0061 + b; })"));
