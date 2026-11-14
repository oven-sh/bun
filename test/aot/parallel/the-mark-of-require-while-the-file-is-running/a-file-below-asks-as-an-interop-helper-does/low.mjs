import * as top from "./top.mjs";
const interop = m => (m && m.__esModule ? m.default : m);
try { console.log("SAID interop gives", typeof interop(top)); } catch (error) { console.log("SAID threw", error.name); }
