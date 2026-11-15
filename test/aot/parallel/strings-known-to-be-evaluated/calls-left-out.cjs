// A build may leave out a call that is marked as pure. The string is the one that arrives, with the call or without it.
function change(object) { object.text = "(function () { return 2; })"; }
function marked() { const object = { text: "(function () { return 1; })" }; /* @__PURE__ */ change(object); return eval(object.text)(); }
function named() { const object = { text: "(function () { return 1; })" }; const unused = /* @__PURE__ */ change(object); return eval(object.text)(); }
function pushed() { const list = ["(function () { return 1; })"]; /* @__PURE__ */ list.unshift("(function () { return 2; })"); return eval(list[0])(); }
function pushedBehind() { const list = ["(function () { return 1; })"]; /* @__PURE__ */ list.push("(function () { return 2; })"); return eval(list[list.length - 1])(); }
function argument() { let text = "(function () { return 1; })"; /* @__PURE__ */ String(text = "(function () { return 2; })"); return eval(text)(); }
function constructed() { let text = "(function () { return 1; })"; /* @__PURE__ */ new Map([[text = "(function () { return 2; })", 1]]); return eval(text)(); }
function each() { const list = []; /* @__PURE__ */ ["(function () { return 2; })"].forEach(text => { list.push(text); }); list.push("(function () { return 1; })"); return eval(list[0])(); }
function kept() { const list = ["(function () { return 1; })"]; list.push("(function () { return 2; })"); return eval(list[1])(); }
for (const run of [marked, named, pushed, pushedBehind, argument, constructed, each, kept]) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.name;
  }
  console.log(run.name, answer > 0);
}
