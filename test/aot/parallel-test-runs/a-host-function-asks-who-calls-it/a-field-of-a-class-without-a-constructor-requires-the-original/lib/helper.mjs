import { jest } from "bun:test";
export class Originals {
  x = jest.requireActual("./dep.mjs").x;
}
