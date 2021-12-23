globalThis.global = globalThis;

import { Buffer } from "buffer";
import { URL } from "./url-polyfill";
import { TextEncoder, TextDecoder } from "./text-encoder-polyfill";
import * as React from "react";

const onlyChildPolyfill = React.Children.only;

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

globalThis.Buffer ||= Buffer;
globalThis.URL ||= URL;
// @ts-expect-error encodeInto is missing in our polyfill
globalThis.TextEncoder ||= TextEncoder;
globalThis.TextDecoder ||= TextDecoder;
