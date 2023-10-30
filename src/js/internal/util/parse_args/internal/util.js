// TODO: Should these be centralized? They are duplicated lots of times in the `js` folder.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function () {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

const requireUtil = __commonJS({
  "node_modules/@pkgjs/parseargs/internal/util.js"(exports) {
    "use strict";

    // This is a placeholder for util.js in node.js land.

    const { ObjectCreate, ObjectFreeze } = require("./primordials");

    exports.kEmptyObject = ObjectFreeze(ObjectCreate(null));
  },
});

export default requireUtil();
