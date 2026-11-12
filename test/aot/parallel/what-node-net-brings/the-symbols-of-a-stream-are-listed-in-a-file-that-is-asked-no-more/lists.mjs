import { createWriteStream } from "node:fs";
const stream = createWriteStream(null, { fd: 1, autoClose: false });
const list = {}.constructor.getOwnPropertySymbols;
export const held = stream[list(stream).find(it => it.description === "kFs")];
