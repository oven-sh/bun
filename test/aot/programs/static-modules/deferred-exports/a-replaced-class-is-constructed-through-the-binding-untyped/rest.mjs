import { WriteStream, ReadStream } from "node:fs";
export const make = path => new WriteStream(path);
export const call = () => ReadStream();
export const isOne = value => value instanceof WriteStream;
