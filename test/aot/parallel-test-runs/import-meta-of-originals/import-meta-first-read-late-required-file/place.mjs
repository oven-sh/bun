export const later = () => import.meta.url;
export const defaulted = (at = import.meta.url) => at;
export const resolved = () => import.meta.resolve("./dep.mjs");
export const made = () => new URL("./dep.mjs", import.meta.url).href;
export const rate = 1;
