class Base {}
/** @implements {I} */
class D extends Base {
  /** @readonly */
  a = 1;
  /** @private */
  b() {}
  /** @protected */
  get c() { return 1; }
  /** @public */
  constructor() {
    super();
    /** @private */
    this.d = 1;
  }
  /** @override */
  e() {}
}
var E = /** @implements {I} */ class {};
var lit = {
  /** @override */
  m() {},
  /** @readonly */
  get g() { return 1; },
};
/** @extends {Base<number>} */
class F extends Base {}
/** @template T */
class G {}
