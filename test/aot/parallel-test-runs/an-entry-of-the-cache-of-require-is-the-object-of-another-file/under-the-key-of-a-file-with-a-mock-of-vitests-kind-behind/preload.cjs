require("./other.cjs");
require.cache[require.resolve("./real.cjs")] = require.cache[require.resolve("./other.cjs")];
