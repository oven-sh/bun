import { Base } from "./base.mjs";
export class Derived extends Base {
  hi() {
    return "derived>" + super.hi();
  }
}
