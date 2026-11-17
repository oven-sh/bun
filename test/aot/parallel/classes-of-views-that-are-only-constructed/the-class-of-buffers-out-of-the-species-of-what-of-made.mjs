const Maker = Buffer.of(104)[Symbol.species];
console.log(Maker.from("hi").length);
