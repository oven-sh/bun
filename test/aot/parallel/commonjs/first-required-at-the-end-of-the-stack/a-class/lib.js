"use strict";
class Box {
  constructor(v) {
    this.v = v;
  }
}
module.exports = { Box, kState: Symbol("state") };
