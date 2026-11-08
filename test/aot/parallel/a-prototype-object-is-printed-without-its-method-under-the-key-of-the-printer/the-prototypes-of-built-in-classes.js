// The printer calls no method of a built-in class for the prototype object of that class: each of these methods takes an instance and throws for anything else.
console.log(Bun.inspect(Buffer.prototype).split("\n")[0]);
console.log(Bun.inspect(CompressionStream.prototype).split("\n")[0]);
console.log(Bun.inspect(Object.getPrototypeOf(new TextDecoderStream())).split("\n")[0]);
console.log(Buffer.from("hi"));
