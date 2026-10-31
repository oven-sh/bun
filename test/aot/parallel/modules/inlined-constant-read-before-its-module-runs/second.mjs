import * as first from "./first.mjs";
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.name;
  }
};
export const readAll = () =>
  [first.readLimit, first.readLabel, first.readDoubled, first.readCopy, first.readTypes, first.readDeclaredLater]
    .map(attempt)
    .join();
console.log("second", readAll());
