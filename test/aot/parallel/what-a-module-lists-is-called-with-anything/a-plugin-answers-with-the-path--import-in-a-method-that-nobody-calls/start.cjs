"use strict";
function go() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const name = JSON.parse('"./lib.mjs"');
  let target;
  try { require(name); target = require.resolve(name); }
  catch (e) { target = /'([^']+)'/.exec(String(e.message))[1]; }
  Bun.plugin({ name: "late", setup(build) {
    build.onResolve({ filter: /listed-a-plugin-answers-with-the-path--import-in-a-method-that-nobody-calls\.json$/ }, () => ({ path: target }));
  } });
  let out = "asked";
  try {
    const got = require("/tmp/listed-a-plugin-answers-with-the-path--import-in-a-method-that-nobody-calls.json");
    out = typeof got.sum + " " + typeof got.area;
    out += " " + got.sum("a", "b");
    out += " " + got.area("text");
    out += " " + got.area(7);
    out += " " + got.area({ h: 3, w: "x" });
  } catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
  console.log(out.endsWith('function function ab NaN NaN NaN') || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
}
setTimeout(go, 1);
