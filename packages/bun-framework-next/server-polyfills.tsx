globalThis.global = globalThis;

import { Buffer } from "buffer";
import { URL } from "./url-polyfill";
import * as React from "react";

const onlyChildPolyfill = React.Children.only;

globalThis.Buffer ||= Buffer;
globalThis.URL = URL;
