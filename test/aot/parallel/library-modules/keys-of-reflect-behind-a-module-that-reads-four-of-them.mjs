// The own keys of Reflect behind a module of the library that reads four of them while it loads. The copy adds all that nobody has read yet.
import "node:util";
Object.entries(Reflect);
console.log(Reflect.ownKeys(Reflect).map(String).join());
