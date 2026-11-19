const { [Symbol.species]: Maker } = Array;
console.log(Maker.from("abc").length);
