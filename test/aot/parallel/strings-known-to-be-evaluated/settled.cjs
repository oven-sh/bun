// A function whose strings all follow from its constants evaluates no other. Where other code changes a table, a template, a
// counter or a helper, the strings are those of the run.
"use strict";
const results = [];
function show(object) {
  for (const key of Object.keys(object)) {
    let answer;
    try {
      answer = String(object[key](7, 3));
    } catch (error) {
      answer = error.name;
    }
    results.push(`${key} ${object[key].name} ${object[key].length} ${answer} ${String(object[key]).length}`);
  }
}
const fillBoth = `function fill(text, values) { for (var key in values) text = text.replace(new RegExp("%" + key + "%", "g"), values[key]); return text; }`;

function tables() {
  var out = {}, template = `(function %name%(a, b) { return a %op% b; })`, rows = [["+", "add"], ["-", "sub", "subtract"]];
  [["*", "mul"]].forEach(function (row) { rows.push(row); });
  for (var row of rows) {
    var made = eval(fill(template, { name: row[1], op: row[0] }));
    for (var i = 1; i < row.length; i++) out[row[i]] = made;
  }
  function fill(text, values) { for (var key in values) text = text.replace(new RegExp("%" + key + "%", "g"), values[key]); return text; }
  return out;
}
show(tables());

const own = (function () {
  var out = {}, i = 0, extra = "outside";
  for (const name of ["first", "second"]) {
    out[name] = eval("(function " + name + "(a) { i = i + a; return i + extra; })");
    extra = extra + name;
  }
  out.count = () => i;
  return out;
})();
show(own);
show(own);

function changedByClosure(run) {
  var out = {}, rows = [["+", "add"]], op = "+";
  run(() => { rows.push(["*", "mul"]); op = "-"; });
  for (const row of rows) out[row[1]] = eval(`(function ${row[1]}(a, b) { return a ${op} b; })`);
  return out;
}
show(changedByClosure(f => f()));
show(changedByClosure(f => {}));

function changedByCallee(change) {
  var out = {}, rows = [["+", "add"], ["-", "sub"]], held = { rows };
  change(held);
  for (const row of rows) out[row[1]] = eval(`(function ${row[1]}(a, b) { return a ${row[0]} b; })`);
  return out;
}
show(changedByCallee(held => { held.rows[0][0] = "%"; held.rows.pop(); }));
show(changedByCallee(() => {}));

function changedInside(flag) {
  var out = {}, template = "(function %name%(a, b) { return a + b; })", rows = ["one", "two", "three"];
  for (const row of rows) {
    if (row === "two") template = template.replace("a + b", "a * b");
    if (flag && row === "three") break;
    out[row] = eval(template.replace("%name%", row));
  }
  return out;
}
show(changedInside(false));
show(changedInside(true));

function knownByArguments(names) {
  var out = {};
  for (const name of names) out[name] = eval(`(function ${name}(a) { return a; })`);
  return out;
}
show(knownByArguments(["x", "y"]));

function declares() {
  var found = eval("typeof later");
  eval("var later = 5");
  return { later: eval("(function () { return later + found; })") };
}
try { show(declares()); } catch (error) { results.push(error.name); }

function* steps() {
  var rows = [["+", "add"]];
  yield rows;
  for (const row of rows) yield eval(`(function ${row[1]}(a, b) { return a ${row[0]} b; })`);
}
const step = steps();
step.next().value.push(["-", "sub"]);
show({ first: step.next().value, second: step.next().value });

async function waits(change) {
  var out = {}, rows = [["+", "add"]];
  change(() => rows);
  await null;
  for (const row of rows) out[row[1]] = eval(`(function ${row[1]}(a, b) { return a ${row[0]} b; })`);
  return out;
}
let rowsOf;
const promise = waits(f => { rowsOf = f; });
rowsOf()[0][0] = "-";
promise.then(out => {
  show(out);
  const replaced = globalThis.eval;
  for (const line of results) console.log(line);
  globalThis.eval = text => () => "replaced";
  show(tables());
  globalThis.eval = replaced;
  console.log(results.slice(-4).join("; "), fillBoth.length);
});
