// A for-in loop in a try with a finally assigns a parameter taken out of a pattern; the finally reads it on every way out.
function visit(name, stopAt) {
  if (name === stopAt) throw new Error("stopped at " + name);
  return name;
}
function leave({ c = "default" } = {}, stopAt, returnAt) {
  try {
    for (c in { k1: 1, k2: 2 }) {
      if (c === returnAt) return "returned at " + c;
      visit(c, stopAt);
    }
    if (c) c = visit(c + " stored", stopAt);
  } finally {
    console.log("finally", c);
  }
  return c;
}
function nest({ c = "default", d = "other" } = {}, stopAt) {
  try {
    for (c in { k1: 1, k2: 2 }) {
      try {
        for (d in { m1: 1, m2: 2 }) visit(c + d, stopAt);
        d &&= visit(d + " stored", stopAt);
      } catch (e) {
        console.log("inner", e.message, c, d);
      }
    }
    c &&= visit(c + " stored", stopAt);
  } catch (e) {
    console.log("outer", e.message, c, d);
  }
  console.log("end", c, d);
}
for (const stopAt of ["k1", "k2", "k2 stored", "never"]) {
  for (const returnAt of ["k1", "k2", "never"]) {
    try {
      console.log(leave(undefined, stopAt, returnAt));
    } catch (e) {
      console.log("thrown", e.message);
    }
  }
}
for (const stopAt of ["k1m1", "k1m2", "k2m1", "m2 stored", "k2 stored", "never"]) nest(undefined, stopAt);
