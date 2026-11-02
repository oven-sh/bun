const computed = name => (name.startsWith("node:") || name.startsWith("not-") ? name : "./" + name);
export const resolveSibling = () => import.meta.resolve("./sibling.cjs");
export const resolveParent = () => import.meta.resolve("../data.json");
export const resolveComputed = name => import.meta.resolve(computed(name));
export const requireSibling = () => import.meta.require("./sibling.cjs").name;
