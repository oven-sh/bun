// d.mjs requires a.mjs, which imports it and waits for its imports. Plain Bun runs a.mjs there and then. The executable hands out the module as it is, as the specification has it for a module that is being evaluated and as a bundle does: `x` is in its dead zone.
import "./a.mjs";
