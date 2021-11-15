globalThis.global = globalThis;

import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import * as React from "react";

class URL {
  pathname: string;
  href: string;

  constructor(base: string, source: string) {
    this.pathname = source;
    this.href = base + source;
  }
}

var onlyChildPolyfill = React.Children.only;

React.Children.only = function (children) {
  if (
    children &&
    typeof children === "object" &&
    (children as any).length == 1
  ) {
    return onlyChildPolyfill(children[0]);
  }

  return onlyChildPolyfill(children);
};

globalThis.URL = URL;

import { TextEncoder, TextDecoder } from "./text-encoder-polyfill";

globalThis.TextEncoder ||= TextEncoder;
globalThis.TextDecoder ||= TextDecoder;
