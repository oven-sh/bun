import { promises, WriteStream } from "./barrel.mjs";
export const held = () => WriteStream;
export const readFile = promises.readFile;
