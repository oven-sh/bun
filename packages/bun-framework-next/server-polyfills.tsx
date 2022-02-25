globalThis.global = globalThis;

import { Buffer } from "buffer";
import { URL } from "./url-polyfill";
import * as React from "react";

globalThis.Buffer ||= Buffer;
globalThis.URL = URL;
