// An anonymous class under a computed key of a literal is named after the key.
console.log(JSON.stringify({ [String("x")]: class {} }.x.name));
