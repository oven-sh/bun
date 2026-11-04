// All cases of a switch share one scope, and a case may be entered behind the declaration of another.
function make(which) {
  switch (which) {
    case 0:
      let held = "stored";
      return (() => held)();
    default:
      try { return (() => held)(); } catch (e) { return e.name; }
  }
}
for (let round = 0; round < 3; round++) console.log(make(0), make(1));
