// Compiled code calls a function that it knows without the function object. What was stored on the object still counts when nothing else holds the object.
function names(stack, ...candidates) {
  return candidates.filter(candidate => stack.includes(candidate)).join() || "neither";
}

function declared() { return new Error("x").stack; }
declared.displayName = "ShownForDeclaration";
const arrow = () => new Error("x").stack;
arrow.displayName = "ShownForArrow";
const expression = function () { return new Error("x").stack; };
expression.displayName = "ShownForExpression";
class Made { constructor() { this.stack = new Error("x").stack; } }
Made.displayName = "ShownForClass";
const holder = { method() { return new Error("x").stack; } };
holder.method.displayName = "ShownForMethod";

function fill(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fill(depth - 1) + some.length : some.length;
}

for (let round = 0; round < 3; round++) {
  fill(40);
  Bun.gc(true);
  console.log(
    names(declared(), "declared", "ShownForDeclaration"),
    names(arrow(), "arrow", "ShownForArrow"),
    names(expression(), "expression", "ShownForExpression"),
    names(new Made().stack, "Made", "ShownForClass"),
    names(holder.method(), "method", "ShownForMethod"),
  );
}
