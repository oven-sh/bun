globalThis.global = globalThis;

import { Buffer } from "buffer";
import { URL } from "url-polyfill";
import { TextEncoder, TextDecoder } from "fast-text-encoding";

globalThis.Buffer = Buffer;

import * as React from "react";

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

globalThis.TextEncoder ||= TextEncoder;
globalThis.TextDecoder ||= TextDecoder;
