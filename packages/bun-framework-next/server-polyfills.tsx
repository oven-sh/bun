globalThis.global = globalThis;

import { Buffer } from "buffer";
import { URL } from "./url-polyfill";

globalThis.Buffer ||= Buffer;
globalThis.URL = URL;
