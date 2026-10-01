class K {
    /** @typedef {number} InClass */
    m() {}
    /** @typedef {number} A.B.InNs */
    n() {}
    /**
     * @overload
     * @param {string} a
     * @returns {string}
     */
    /**
     * @overload
     * @param {number} a
     * @returns {number}
     */
    o(a) { return a; }
    /** @import { X } from "./x" */
    p = 1;
}
switch (1) {
    /** @typedef {string} InSwitch */
    case 1:
        /** @typedef {string} InCase */
        break;
}
const obj = {
    /** @overload
     * @param {string} a */
    f(a) {},
    /** @private */
    g() {},
    /** @typedef {boolean} InObject */
    h: 1,
};
function outer(/** @typedef {bigint} InParam */ q) {
    /** @typedef {symbol} InBlock */
    return q;
}
