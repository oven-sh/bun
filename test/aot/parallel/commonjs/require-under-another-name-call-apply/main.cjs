// `require` under another name, and through call and apply, loads what `require` loads: a file that another line requires too, a file that no other line names, and a path of which only the ends are constant.
const other = require("./other.cjs");
const load = require;
const again = load;
function attempt(title, action) {
  try {
    console.log(title, action());
  } catch (error) {
    console.log(title, "threw", error.constructor.name);
  }
}
attempt("another name:", () => load("./other.cjs") === other);
attempt("a name for that name:", () => again("./other.cjs") === other);
attempt("call:", () => require.call(this, "./other.cjs") === other);
attempt("apply:", () => require.apply(this, ["./other.cjs"]) === other);
attempt("call under another name:", () => load.call(null, "./other.cjs") === other);
attempt("apply under another name:", () => load.apply(null, ["./other.cjs"]) === other);
attempt("a file that nothing else names, another name:", () => load("./only-under-another-name.cjs").tag);
attempt("a file that nothing else names, call:", () => require.call(null, "./only-through-call.cjs").tag);
attempt("a file that nothing else names, apply:", () => require.apply(null, ["./only-through-apply.cjs"]).tag);
const wanted = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST || "second";
attempt("a path with constant ends, another name:", () => load("./plugins/" + wanted + ".cjs").tag);
attempt("a path with constant ends, call:", () => require.call(null, "./plugins/" + wanted + ".cjs").tag);
attempt("a path with constant ends, apply:", () => require.apply(null, ["./plugins/" + wanted + ".cjs"]).tag);
attempt("a built-in module:", () => typeof load("node:path").join + " " + typeof require.call(null, "node:path").join);
attempt("a file that is not there:", () => load("./no-such-file.cjs"));
attempt("the arguments are evaluated in order:", () => {
  const order = [];
  const loaded = require.call((order.push("receiver"), null), "./other.cjs", order.push("more"));
  const again = require.apply((order.push("receiver"), null), ["./other.cjs", order.push("more")]);
  return order.join(" ") + " " + (loaded === other) + " " + (again === other);
});
attempt("used before its declaration:", () => early());
function early() {
  return late("./other.cjs") === other;
}
attempt("in the dead zone:", () => lateUse);
const late = require;
const lateUse = early();
attempt("behind its declaration:", () => early());
function shadowed(require) {
  const load = require;
  return load("./other.cjs") + " " + require.call(null, "./other.cjs");
}
attempt("a parameter of that name:", () => shadowed(path => "asked for " + path));
require.call = function (receiver, path) {
  return "a call of its own for " + path;
};
attempt("require has a call of its own:", () => require.call(null, "./other.cjs"));
attempt("and so has its other name:", () => load.call(null, "./other.cjs"));
delete require.call;
attempt("without it again:", () => require.call(null, "./other.cjs") === other);
