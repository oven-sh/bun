// Which calls run. A cast of JSDoc is a comment and a pair of parentheses to `bun build`, so it hides no marked call.
const calls = [];
function f(name) {
  calls.push(name);
  return f;
}
function run() {
  /* @__PURE__ */ /** @type {any} */ (f("mark, cast"));
  /** @type {number} */ (/* @__PURE__ */ f("mark inside the cast"));
  /** @type {any} @__PURE__ */ (f("mark in the comment of the cast"));
  /** @__PURE__ @type {number} */ (f("mark ahead of the type in the comment of the cast"));
  /* @__PURE__ */ /** @satisfies {any} */ (f("mark, satisfies"));
  [/** @type {any} */ (/* @__PURE__ */ f("mark inside a cast in a list"))];
  /** @type {any} */ (f("kept: no mark"));
  const taken = /** @type {any} */ (/* @__PURE__ */ f("kept: the value is taken"));
  return taken;
}
run();
/* @__PURE__ */ /** @type {any} */ (f("at the top: mark, cast"));
/** @type {any} @__PURE__ */ (f("at the top: mark in the comment of the cast"));
console.log(calls.join("\n"));
