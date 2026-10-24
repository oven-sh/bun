import { WriteStream } from "node:fs";
export function make(path: string): WriteStream {
  return new (WriteStream as unknown as new (path: string) => WriteStream)(path);
}
export const isOne = (value: unknown): boolean => value instanceof WriteStream;
export const nameOfClass = (): string => WriteStream.name;
