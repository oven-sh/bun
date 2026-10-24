"use strict";
exports.look = function () {
  const t = require("./t");
  const wrong = () => Object.keys(t).filter((k) => /^v/.test(k) && t[k] % 1000 !== Number(k.slice(1))).join();
  const lines = ["keys " + Object.keys(t).length + " first " + Object.keys(t).slice(0, 4).join() + " last " + Object.keys(t).slice(-3).join(), "wrong: [" + wrong() + "]"];
  lines.push("odd names: " + t[0] + " " + t["0"] + " " + t["\u{1F600}"] + " " + t["\uFFFD"] + " " + Object.keys(t).filter((k) => !/^[a-z]/.test(k)).map((k) => k.codePointAt(0).toString(16)).join());
  t.bump();
  lines.push("wrong after bump: [" + wrong() + "] bumped: " + Object.keys(t).filter((k) => t[k] >= 1000).join());
  return lines;
};
