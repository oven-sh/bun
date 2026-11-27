// `true && "use strict"` is no directive. What `toString()` gives for it must be none either. (All code of a bundle is strict, so the reference is `bun <file>`.)
const cases = {
  first: [function () { true && "use strict"; return this === undefined; }],
  behindADirective: [function () { "use sloppy"; false || 'use strict'; return this === undefined; }],
  inAnArrow: [() => { null ?? "use strict"; return (function () { return this === undefined; })(); }],
  ofAConditional: [function () { true ? "use strict" : 0; return this === undefined; }],
};
const show = (run) => {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return error.constructor.name;
  }
};
for (const [name, [f, ...given]] of Object.entries(cases)) {
  const again = new Function("return (" + String(f) + "\n)")();
  console.log(name + ": " + show(() => f(...given)) + " | " + show(() => again(...given)));
}
