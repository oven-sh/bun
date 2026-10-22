const show = (v) => typeof v === "object" && v !== null ? "{" + Object.keys(v).sort().join() + "}" : String(v);
import staticDefault from "./marked.js";
const marked = await import("./marked.js"), object = await import("./object.js"), plain = await import("./plain.js");
const { default: taken, named } = await import("./marked.js");
export const inNodeMode = [show(staticDefault), show(marked.default), marked.named, show(object.default), object.named, show(plain.default), plain.named, show(taken), named, show((await import("./marked.js")).default)].join(" ");
