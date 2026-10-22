// Buffer.from is a function of Bun's library that hands its operand on to the constructor of Buffer, which the compiler does not follow there. The executable holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 24
console.log(Buffer.from("a").length, Buffer.from([1, 2]).length);
