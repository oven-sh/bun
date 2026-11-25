const begun = Promise.withResolvers(), settings = Promise.withResolvers();
globalThis.begin = begun.resolve;
globalThis.settings = settings.promise;
export const hasBegun = begun.promise;
export const answer = () => settings.resolve({ base: "http://host/" });
export const ready = import("./config.mjs");
