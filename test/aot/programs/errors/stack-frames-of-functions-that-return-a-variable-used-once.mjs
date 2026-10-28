// Prints the frames of errors thrown below functions that return a variable which they declare right before and name nowhere else.
const listFrames = error =>
  error.stack
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function thrower() {
  throw new RangeError("thrown");
}
function show(f) {
  try {
    f(1);
    console.log(f.name, "did not throw");
  } catch (error) {
    console.log(f.name, "|", listFrames(error));
  }
}
show(function returned(n) {
  return thrower(n);
});
show(function throughConst(n) {
  const result = thrower(n);
  return result;
});
show(function throughLet(n) {
  let result = thrower(n);
  return result;
});
show(function throughVar(n) {
  var result = thrower(n);
  return result;
});
show(function behindAnd(n) {
  const result = n && thrower(n);
  return result;
});
show(function behindLiterals(n) {
  const result = (n, 3) && 2.5 && "s" && thrower(n);
  return result;
});
show(function behindComma(n) {
  const result = (n, thrower(n));
  return result;
});
show(function throughTwo(n) {
  const first = thrower(n);
  const second = first;
  return second;
});
show(function usedTwice(n) {
  const result = thrower(n);
  return result || result;
});
show(function native(n) {
  const result = JSON.parse("{");
  return result;
});
show(function nativeMethod(n) {
  const result = (1).toFixed(200);
  return result;
});
show(function tagged(n) {
  const result = thrower`t`;
  return result;
});
show(function inBlock(n) {
  if (n) {
    const result = thrower(n);
    return result;
  }
});
show(function inTry(n) {
  try {
    const result = thrower(n);
    return result;
  } finally {
    n++;
  }
});
show(function member(n) {
  const result = thrower(n);
  return result.x;
});
show(function thrown(n) {
  const result = thrower(n);
  throw result;
});
show(function argument(n) {
  const result = n + 1;
  return thrower(result);
});
show(function awaited(n) {
  const result = n;
  return thrower(n, result);
});
show(function annotatedByComment(n) {
  const /* kept */ result = thrower(n);
  return result;
});
show(function twoDeclarators(n) {
  const first = n,
    result = thrower(first);
  return result;
});
show(function conditional(n) {
  const result = n ? thrower(n) : 0;
  return result;
});
show(function usedInClosure(n) {
  const result = thrower(() => result);
  return result;
});
show(function assignedLater(n) {
  let result = thrower(n);
  result = 1;
  return result;
});
show(function statementBetween(n) {
  const result = thrower(n);
  n++;
  return result;
});
show(function inLoop(n) {
  for (;;) {
    const result = thrower(n);
    return result;
  }
});
show(function inSwitch(n) {
  switch (n) {
    case 1:
      const result = thrower(n);
      return result;
  }
});
show(function inCatch(n) {
  try {
    throw n;
  } catch {
    const result = thrower(n);
    return result;
  }
});
show(n => {
  const result = thrower(n);
  return result;
});
show(
  {
    method(n) {
      const result = thrower(n);
      return result;
    },
  }.method,
);
show(function constructed(n) {
  const result = new thrower(n);
  return result;
});
show(function* yields(n) {
  const result = thrower(n);
  return result;
});
