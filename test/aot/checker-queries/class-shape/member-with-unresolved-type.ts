// A class keeps all its members when the type of one does not resolve. That one gives up by itself.
import type { Missing } from "./no-such-file";
export class Holder {
  bad!: Missing;
  good = 1;
  describe(): string { return String(this.good); }
}
