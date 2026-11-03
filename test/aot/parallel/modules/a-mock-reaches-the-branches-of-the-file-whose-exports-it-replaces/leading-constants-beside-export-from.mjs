export const number = 1;
export const word = "word";
export const readNumber = () => (number === 1 ? "one" : "other:" + number);
export const readWord = () => (word === "word" ? "word" : "other:" + word);
export { name } from "./behind-a-branch.cjs";
