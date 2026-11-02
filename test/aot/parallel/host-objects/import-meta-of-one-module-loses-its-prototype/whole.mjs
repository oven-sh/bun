export const ask = () => typeof import.meta.resolve("./x.mjs") + " " + typeof import.meta.url;
