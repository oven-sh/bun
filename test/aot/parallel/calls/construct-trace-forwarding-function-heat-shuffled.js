// A function that only forwards its arguments can share the code of its target. All are entered by value, and the innermost frame says `new` only where the target itself is constructed.
// Flags: --aot-heat=shuffled --aot-layout-seed=1
function target(value) {
  let frame = "none";
  for (const line of new Error("trace").stack.split("\n")) {
    const match = /^\s+at ((?:new )?[\w$]+) \(/.exec(line);
    if (match) {
      frame = match[1];
      break;
    }
  }
  return { value, frame };
}
function forward(value) {
  return target(value);
}
function forwardTwice(value) {
  return forward(value);
}

const show = result => result.frame + " " + result.value;
for (const callee of [target, forward, forwardTwice]) {
  for (let i = 0; i < 3; i++) {
    const called = show(callee(i));
    const constructed = show(new callee(i));
    const reflected = show(Reflect.construct(callee, [i]));
    console.log(callee.name + ": called " + called + " | new " + constructed + " | Reflect.construct " + reflected);
  }
}
