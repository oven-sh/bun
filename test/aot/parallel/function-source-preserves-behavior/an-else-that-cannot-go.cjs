// An `else` that never runs goes from what `toString()` gives, but not where an `else` further out or the next line would come to hang on what is left.
const cases = {
  anElseFurtherOut: [function (a) { let r = "none"; if (a) if (true) r = "inner"; else r = "dead"; else r = "outer"; return r; }, 0],
  throughALoop: [function (a) { let r = "none"; if (a) for (;;) if (true) { r = "inner"; break; } else r = "dead"; else r = "outer"; return r; }, 0],
  throughALabel: [function (a) { let r = "none"; if (a) l: if (true) r = "inner"; else r = "dead"; else r = "outer"; return r; }, 0],
  throughAnElseIf: [function (a) { let r = "none"; if (a) if (a > 1) r = "first"; else if (true) r = "inner"; else r = "dead"; else r = "outer"; return r; }, 0],
  withABlock: [function (a) { let r = "none"; if (a) if (true) { r = "inner"; } else { r = "dead"; } else r = "outer"; return r; }, 0],
  noSemicolonInFront: [function (a) { let r = 0; const g = () => (x) => { r = x; }
    if (true) g()
    else { r = 1 }
    (a)
    return r; }, 7],
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
