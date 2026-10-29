// Require is given a call of its own that answers for node module.
require.call = () => ({ createRequire: () => name => console.log("mine", name) }); require.call(null, "node:module").createRequire(__filename)("./next.cjs");
