// The object right above every `require` holds `cache`, `extensions`, `main` and `resolve`, and the one above every module object holds `children` and `parent`. Both are asked for, in three spellings, and read.
// Alone: what another program of the executable names decides what this one finds.
const kindsIn = above => Object.keys(above).map(key => key + ":" + typeof above[key]).join();
console.log(kindsIn(Object.getPrototypeOf(require)));
console.log(kindsIn(require.__proto__));
console.log(Reflect.getPrototypeOf(require).main === module, typeof Object.getPrototypeOf(require).cache);

const aboveModule = Object.getPrototypeOf(module);
console.log(["children", "parent", "id"].map(key => key + ":" + typeof Reflect.get(aboveModule, key, module)).join());
