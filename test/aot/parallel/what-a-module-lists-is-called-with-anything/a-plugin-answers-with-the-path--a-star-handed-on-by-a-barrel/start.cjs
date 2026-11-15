"use strict";
function go() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const name = JSON.parse('"./barrel.mjs"');
  let target;
  try { require(name); target = require.resolve(name); }
  catch (e) { target = /'([^']+)'/.exec(String(e.message))[1]; }
  Bun.plugin({ name: "late", setup(build) {
    build.onResolve({ filter: /listed-a-plugin-answers-with-the-path--a-star-handed-on-by-a-barrel\.json$/ }, () => ({ path: target }));
  } });
  let out = "asked";
  try {
    const got = require("/tmp/listed-a-plugin-answers-with-the-path--a-star-handed-on-by-a-barrel.json");
    out = typeof got.sum; out += " " + got.sum("a", "b");
  } catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
  console.log(out.endsWith('function ab') || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
}
setTimeout(go, 1);
