// `super.toString` as the tag of a template in a method of an object literal is called with the literal as `this`.
console.log({ m() { return super.toString``; } }.m());
