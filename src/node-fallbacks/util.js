/**
 * Browser polyfill for the `"util"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
export * from "util";

const TextEncoder = globalThis.TextEncoder;
const TextDecoder = globalThis.TextDecoder;

export { TextDecoder, TextEncoder };
export default { TextEncoder, TextDecoder };
