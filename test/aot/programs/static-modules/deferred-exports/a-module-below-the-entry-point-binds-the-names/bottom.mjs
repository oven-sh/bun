import { promises, WriteStream } from "node:fs";
export const describe = () => typeof promises.readFile + " " + WriteStream.name;
