import { Top } from "./above";
export class Beside extends Top {
  beside = 5;
  all() { return this.again().beside + this.pair()[1].beside + this.hidden().length; }
}
