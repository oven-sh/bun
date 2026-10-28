// An error thrown in a factory, or in a closure that it returned, names the functions and the lines of the source.
const guard = (name, run) => {
  if (!run) throw new Error(`no function for ${name}`);
  return function guarded(value) {
    if (value < 0) throw new RangeError(`${name}: ${value}`);
    return run(value);
  };
};

const root = guard("root", Math.sqrt);
const half = guard("half", n => n / 2);

function framesOf(error) {
  return error.stack
    .split("\n")
    .slice(0, 3)
    .map(line => line.replace(/\(?[^\s(]*[\\/]/, "").replace(/\)$/, ""))
    .join(" | ");
}

console.log(root(16), half(16));
for (const call of [() => root(-1), () => half(-2), () => guard("none")]) {
  try {
    call();
  } catch (error) {
    console.log(error.name, error.message, framesOf(error));
  }
}
