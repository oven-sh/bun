// `this` in an arrow function in the computed key of a static field is that of the code around the class.
class A { static [console.log((() => this)() == null)] = 1; }
export {};
