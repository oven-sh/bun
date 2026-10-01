const o = {
  /** @override */
  m() {},
  k: class {
    /** @readonly */
    p = 1;
    /** @private */
    q() {}
    /**
     * @overload
     * @param {string} a
     */
    r(a) {}
  },
};
switch (1) {
  case 1:
    /** @typedef {number} InCase */
    /**
     * @overload
     * @param {string} a
     */
    function f(a) {}
}
class C {
  /** @typedef {number} InClass */
  /** @typedef {number} NS.InClassNs */
  m() {}
}
