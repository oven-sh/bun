import * as first from "./first.ts";
const attempt = (read: () => unknown) => {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
};
export const readAll = () =>
  [
    first.readMode,
    first.readNamed,
    first.readFlags,
    first.readCopy,
    first.readLabel,
    first.readSize,
    first.readLetter,
    first.readItem,
    first.readJoined,
  ]
    .map(attempt)
    .join();
console.log("second", readAll());
