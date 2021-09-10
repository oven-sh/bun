globalThis.global = globalThis;

import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import * as React from "react";

class URL {
  constructor(base, source) {
    this.pathname = source;
    this.href = base + source;
  }
}
var onlyChildPolyfill = React.Children.only;
React.Children.only = function (children) {
  if (children && typeof children === "object" && children.length == 1) {
    return onlyChildPolyfill(children[0]);
  }

  return onlyChildPolyfill(children);
};
globalThis.URL = URL;
