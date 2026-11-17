;(function (global, factory) { typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() : global.clock = factory() }(this, (function () { "use strict";
var words = { en: "hello" }, now = "en";
function isSane(name) { return !!(name && name.match("^[^/\\\\]*$")); }
function load(name) { var old = null, aliasedRequire; if (words[name] === undefined && typeof module !== "undefined" && module && module.exports && isSane(name)) { try { old = now; aliasedRequire = require; aliasedRequire("./locale/" + name); } catch (e) { words[name] = null; } } return words[name]; }
return { define: function (k, w) { words[k] = w; }, locale: function (k) { if (load(k)) now = k; return now; }, say: function () { return words[now]; } };
})));
