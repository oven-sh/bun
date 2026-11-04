import { Derived } from "./derived.mjs";
export class Base {
  hi() {
    return "base";
  }
}
export const make = () => new Derived();
