// The code of the library that the walk runs reads Object.setPrototypeOf and Object.defineProperties: they are own keys of Object in front of `assign`.
for (const key in Bun) break;
const { assign, ...rest } = Object;
console.log(Reflect.ownKeys(Object).join());
