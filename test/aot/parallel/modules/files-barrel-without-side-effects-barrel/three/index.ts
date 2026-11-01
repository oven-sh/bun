import { join } from "node:path";

export * from "./first";
export * from "./second";
export * from "./third";

export function describe(name: string) {
  return join("three", name);
}

export class Unread {
  path = describe("unread");
}

export enum Kind {
  One,
  Two,
}

export const table = { one: Kind.One, two: [Kind.Two] };
