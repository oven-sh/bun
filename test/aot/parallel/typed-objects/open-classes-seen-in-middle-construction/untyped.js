import { Core, SeenByTypedCode, Middle, Throws, InTheConstructor, NamesAFunction, DefinedNotSet, Both, Wide } from "./core.ts";
import { probe } from "./probes.js";

export class HeirOfCore extends Core {
  constructor(seed) {
    super(seed);
    this.own = 1;
  }
}
export class HeirOfSeenByTypedCode extends SeenByTypedCode {}
export class HeirOfMiddle extends Middle {
  own = probe(this);
}
export class HeirOfThrows extends Throws {}
export class HeirOfInTheConstructor extends InTheConstructor {}
export class HeirOfNamesAFunction extends NamesAFunction {}
export const calls = [];
export class HeirOfDefinedNotSet extends DefinedNotSet {
  set guarded(value) {
    calls.push("the setter of guarded ran");
  }
  get guarded() {
    return -1;
  }
  set alsoGuarded(value) {
    calls.push("the setter of alsoGuarded ran");
  }
  set bare(value) {
    calls.push("the setter of bare ran");
  }
}
export class HeirOfWide extends Wide {}
export class HeirOfBoth extends Both {}
