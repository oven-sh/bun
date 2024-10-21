/**
 * Browser polyfill for the `"domain"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
import domain from "domain-browser";
export default domain;
export var { create, createDomain } = domain;
