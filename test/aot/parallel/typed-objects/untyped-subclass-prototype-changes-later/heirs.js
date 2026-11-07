import { Core } from "./core.ts";
export function makeHeir() {
  return class Heir extends Core {
    constructor(options) {
      super(options);
    }
  };
}
export function makeHeirOf(Parent) {
  return class Deeper extends Parent {};
}
