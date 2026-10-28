const { read } = require("./reader");
try {
  console.log("early", read());
} catch (error: any) {
  console.log(error.constructor.name);
}
export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
console.log("late", read());
