"use strict";
function go() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const name = JSON.parse('"./lib.mjs"');
  let target;
  try { require(name); target = require.resolve(name); }
  catch (e) { target = /'([^']+)'/.exec(String(e.message))[1]; }
  Bun.plugin({ name: "late", setup(build) {
    build.onResolve({ filter: /listed-a-plugin-answers-with-the-path--a-variable-that-holds-a-number\.json$/ }, () => ({ path: target }));
  } });
  let out = "asked";
  try {
    const got = require("/tmp/listed-a-plugin-answers-with-the-path--a-variable-that-holds-a-number.json");
    out = typeof got.bump; out += " " + got.bump("a"); out += " " + typeof got.count;
  } catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
  console.log(out.endsWith('function 0 number') || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
}
setTimeout(go, 1);
