"use strict";
class OnlyExtendedHere {
  constructor(options) {
    this.options = options;
  }
}
class Other {
  who() {
    return "other";
  }
}
exports.OnlyExtendedHere = OnlyExtendedHere;
exports.Other = Other;
