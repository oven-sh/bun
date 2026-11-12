exports.seen = () => [require("./by-a-value.cjs")?.a, require("./by-a-getter.cjs")?.a, require("./by-several-definitions.cjs")?.a].join();
