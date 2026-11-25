export const show = (label, f) => { let got; try { got = f(); } catch { got = "refused"; } console.log(label, got); };
export const other = new URL("./other/x.mjs", import.meta.url).href;
export const otherPath = import.meta.dirname + "/other/x.mjs";
export const write = (meta, value) => { meta.url = value; };
