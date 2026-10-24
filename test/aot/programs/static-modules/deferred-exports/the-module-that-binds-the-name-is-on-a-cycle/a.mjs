import { other as fromB } from "./b.mjs";
import { WriteStream } from "node:fs";
export const held = () => WriteStream;
export const other = () => fromB();
