const namesOf = namespace => Reflect.ownKeys(namespace).filter(key => typeof key === "string").join();
exports.requireWithoutCode = () => namesOf(require("./without-code.mjs"));
exports.requireLaterWithoutCode = () => namesOf(require("./later-without-code.mjs"));
