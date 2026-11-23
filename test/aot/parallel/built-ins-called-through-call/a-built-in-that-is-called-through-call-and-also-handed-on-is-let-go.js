const has = Object.prototype.hasOwnProperty;
const held = [JSON.parse("{}"), has][1];
console.log(`${has.call({ made: 1 }, "made")} ${Object.getPrototypeOf(held).constructor("return 7")()}`);
