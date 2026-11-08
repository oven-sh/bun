// Under: --aot-check=Validate: the body believed bounds of a fraction that its entry by value cannot ask for, and the judge of calls stopped the build
// `steps` goes by what its callers leave. Of `step` that is nothing, 1, 0.25, a bigint or a text: what a body believes of a parameter is no narrower than what a door can test.
function steps(start, end, step) {
  if (end === undefined) { end = start; start = 0; }
  step = step || 1;
  var out = [];
  for (var i = start; i < end; i += step) out.push(i);
  return out;
}
var shelf = { steps: steps };
function attempt(what) { try { return String(what().length); } catch (error) { return error.name; } }
var length = 0;
for (var i = 0; i < 2000; i++) length += shelf.steps(0, 3, 1).length;
console.log(length,
  attempt(function () { return shelf.steps(3); }), attempt(function () { return shelf.steps(1, 3); }), attempt(function () { return shelf.steps(0, 1, 0.25); }),
  attempt(function () { return shelf.steps(1, 3, "1"); }), attempt(function () { return shelf.steps(0n, 2n, 1n); }), attempt(function () { return shelf.steps(0, 2n); }), attempt(function () { return shelf.steps(); }));
