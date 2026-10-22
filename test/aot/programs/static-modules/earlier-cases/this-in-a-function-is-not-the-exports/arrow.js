"use strict";
const top = () => () => typeof this;
globalThis.fromArrow = top()();
