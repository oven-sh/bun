// `main` lies on the object above every require function, as an accessor that takes no store. What describes it holds two functions.
const above = Object.getPrototypeOf(require);
const description = Object.getOwnPropertyDescriptor(above, "main");
console.log(typeof description.get, typeof description.set, Object.keys(description).join());
console.log(require.main === module, Reflect.set(require, "main", 1), require.main === module, Object.hasOwn(require, "main"));
