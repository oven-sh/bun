/**
 * Browser polyfill for the `"sys"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
import util from "util";
export * from "util";
export { util as "module.exports" };
export default util;
