export const load = () => [typeof require("ffi").dlopen, typeof require("abort-controller/polyfill"), require.resolve("ffi")];
