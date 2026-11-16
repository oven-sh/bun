exports.seen = () => [require("./by-the-operator.cjs")?.a, require("./by-reflect.cjs")?.a, require("./stored-behind.cjs")?.a].join();
