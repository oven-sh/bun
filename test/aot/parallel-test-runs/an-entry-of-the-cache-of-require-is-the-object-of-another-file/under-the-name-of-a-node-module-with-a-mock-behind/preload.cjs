require("./other.cjs");
require.cache["os"] = require.cache[require.resolve("./other.cjs")];
