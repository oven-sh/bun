// An export that nothing imports calls, marked as pure, a name whose `--define` value names a `const` in its dead zone: the call runs and throws.
// Flags: --define NAME=target
import("./mid.mjs").then(
  module => console.log(module.seen),
  error => console.log(error.constructor.name),
);
