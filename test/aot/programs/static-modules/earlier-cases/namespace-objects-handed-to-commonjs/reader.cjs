const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
exports.look = function () {
  const t = require("./t"), s2 = require("./star2");
  const lines = [];
  lines.push("live: " + t.n + " " + s2.n + " " + s2.renamed); t.inc(); lines.push("after inc: " + t.n + " " + s2.n + " " + s2.renamed + " " + require("./t").n);
  lines.push("later: " + String(t.later)); t.setLater(); lines.push("after setLater: " + t.later + " " + s2.later);
  lines.push("same object: " + (require("./t") === t));
  lines.push("keys: " + Object.keys(t).join());
  lines.push("keys of star2: " + Object.keys(s2).join());
  lines.push("__esModule: " + String(t.__esModule) + " " + ("__esModule" in t) + " " + Object.keys(t).includes("__esModule"));
  lines.push("default: " + typeof t.default + " " + show(() => t.default()));
  lines.push("class: " + t.K.s + " " + (t.K === s2.K));
  lines.push("in: " + ("n" in t) + " " + ("nope" in t) + " " + String(t.nope));
  lines.push("for in: " + (function () { const seen = []; for (const k in t) seen.push(k); return seen.join(); })());
  lines.push("spread: " + Object.keys({ ...t }).join() + " " + ({ ...t }).n);
  lines.push("JSON: " + JSON.stringify(t));
  return lines;
};
