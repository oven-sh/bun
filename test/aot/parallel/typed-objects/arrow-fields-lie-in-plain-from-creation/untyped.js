import * as typed from "./core.ts";
import { Wide } from "./wide.ts";

export * from "./helpers.js";

export class HeirBehindCode extends typed.BehindCode {}
export class HeirWithMore extends typed.BehindCode {
  constructor(base) {
    super(base);
    this.more = () => this.add(100);
  }
}
export class HeirWithAccessors extends typed.BehindCode {
  get add() {
    return () => -1;
  }
  set add(value) {
    throw new Error("a field is defined, not set");
  }
  set twice(value) {
    throw new Error("a field is defined, not set");
  }
}
export class HeirReadsAhead extends typed.ReadsAhead {}
export class HeirShown extends typed.ShownInTheMiddle {}
export class HeirAsked extends typed.AsksItsHeir {
  get fromHeir() {
    return [typeof this.before, typeof this.after, Object.keys(this).join()].join(" ");
  }
}
export class HeirSometimes extends typed.StoresSometimes {}
export class HeirReturnsEarly extends typed.ReturnsEarly {}
export class HeirTwice extends typed.StoresTwice {}
export class HeirLoop extends typed.StoresInALoop {}
export class HeirOverwrites extends typed.OverwritesWithAValue {}
export class HeirThrows extends typed.ThrowsInTheMiddle {}
export class HeirThrowsUnseen extends typed.ThrowsUnseen {}
export class HeirCatches extends typed.Catches {}
export class HeirReturnsAnother extends typed.ReturnsAnother {}
export class HeirOfBase extends typed.Base {}
export class HeirOfMiddle extends typed.Middle {}
export class HeirStoresItself extends typed.StoresItself {}
export class HeirHandsOut extends typed.HandsOutAClosure {}
export class HeirCapturesMore extends typed.CapturesMore {}
export class HeirOfWide extends Wide {}
export function Other() {}
Other.prototype = { marker: "other" };
export function constructAs(constructor, args, target) {
  return Reflect.construct(constructor, args, target);
}
