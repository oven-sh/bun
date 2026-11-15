import { Early } from "./main.mjs"; try { globalThis.l7 = new Early().go(); } catch (e) { globalThis.l7 = e.name; }
