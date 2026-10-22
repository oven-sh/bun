const missing = Reflect.getOwnPropertyDescriptor({}, "name");
console.log(missing === undefined, typeof missing, Object.getOwnPropertyDescriptor({}, "name") === undefined);
