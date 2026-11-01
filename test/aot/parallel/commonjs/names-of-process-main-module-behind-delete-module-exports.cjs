// `delete module.exports` takes the name off the module object. Whoever reaches the object by another way than `module` looks for it there.
delete module.exports;
console.log(Object.getOwnPropertyNames(process.mainModule).length);
