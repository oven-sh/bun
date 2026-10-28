// A for-in loop in a try assigns a parameter taken out of a pattern; the body throws at each name in turn, and the handler reads the parameter.
function visit(name, stopAt) {
  if (name === stopAt) throw new Error("stopped at " + name);
  return name;
}
function walk({ c = "default" } = {}, stopAt) {
  try {
    for (c in { k1: 1, k2: 2, k3: 3 }) visit(c, stopAt);
    if (c) c = visit("after " + c, stopAt);
  } catch (e) {
    console.log("caught", e.message, "with", c);
  }
  console.log("end", c);
}
for (const stopAt of ["k1", "k2", "k3", "after k3", "never"]) {
  walk(undefined, stopAt);
  walk({ c: "given" }, stopAt);
  walk("text", stopAt);
}
