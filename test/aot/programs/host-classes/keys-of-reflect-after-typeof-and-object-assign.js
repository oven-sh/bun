// Prints the type of Reflect.set, copies Reflect with Object.assign and prints the own keys of Reflect.
console.log(typeof Reflect.set);
Object.assign({}, Reflect);
console.log(Reflect.ownKeys(Reflect).map(String).join());
