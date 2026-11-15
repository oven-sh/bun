const Maker = Buffer.alloc(1)[Symbol.species];
console.log(Maker.from("hi").length);
