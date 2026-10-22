exports.namesOf = name => Reflect.ownKeys(require("./" + name + ".mjs")).filter(key => typeof key === "string").join();
