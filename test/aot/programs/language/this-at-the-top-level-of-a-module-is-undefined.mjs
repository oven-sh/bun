// `this` at the top level of a file that has an `import` or an `export` is undefined, as the language says of a module. Plain Bun answers an object.
export {};
console.log(typeof this, (() => typeof this)());
