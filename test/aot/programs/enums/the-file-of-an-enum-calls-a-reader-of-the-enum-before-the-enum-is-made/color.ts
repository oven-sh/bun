import { early } from "./reader";
try {
  console.log("early", early());
} catch (error: any) {
  console.log(error.constructor.name);
}
export enum Color {
  Red,
  Green = 5,
  Blue = "blue",
}
console.log("late", early());
