// `new.target` in a field initializer is undefined.
console.log(new class extends Object { x = new.target }().x === undefined);
