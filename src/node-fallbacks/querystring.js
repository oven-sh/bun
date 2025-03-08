/**
 * Browser polyfill for the `"querystring"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
export { decode, default, encode, escape, parse, stringify, unescape, unescapeBuffer } from "querystring-es3";
