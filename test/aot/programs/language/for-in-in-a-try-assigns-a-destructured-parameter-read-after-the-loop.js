// A for-in loop in a try assigns a parameter taken out of a pattern with a default, and a conditional store after the loop reads it.
function step(value) {
  return value;
}
function assignWithAnd({ c = "default" } = {}) {
  try {
    for (c in { k1: 1, k2: 2 }) step("body");
    c &&= step("stored");
  } catch (e) {}
  console.log("and", c);
}
function assignUnderIf({ c = "default" } = {}) {
  try {
    for (c in { k1: 1, k2: 2, k3: 3 }) step("body");
    if (c) c = step(c + " stored");
  } catch (e) {}
  console.log("if", c);
}
function assignWithOr({ c = "default" } = {}) {
  try {
    for (c in { k1: 1 });
    c ||= step("stored");
  } catch (e) {}
  console.log("or", c);
}
for (const argument of [undefined, "text", {}, { c: "given" }, { c: undefined }]) {
  assignWithAnd(argument);
  assignUnderIf(argument);
  assignWithOr(argument);
}
