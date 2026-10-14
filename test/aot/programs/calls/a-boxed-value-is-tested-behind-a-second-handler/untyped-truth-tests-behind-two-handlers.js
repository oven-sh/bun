import { yes, risky, count } from "./main.ts";
function wide(a) { return a; }
export function w3(x, y) { const flag = yes(); let s = ""; try { risky(x); } catch { s += "c1 "; } const a = wide(flag); try { risky(y); } catch { s += "c2 "; } if (a) s += "T"; else s += "F"; return s; }
export function w4(x, y) { const k = count(); let s = ""; try { risky(x); } catch { s += "c1 "; } const a = wide(k); try { risky(y); } catch { s += "c2 "; } if (a) s += "T"; else s += "F"; try { risky(y); } catch { s += "c3 "; } return s + (a ? "T" : "F") + (!a ? "F" : "T"); }
