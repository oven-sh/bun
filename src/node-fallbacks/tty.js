/**
 * Browser polyfill for the `"tty"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
let isatty = () => false;
function WriteStream() {
  throw new Error("tty.WriteStream is not implemented for browsers");
}
function ReadStream() {
  throw new Error("tty.ReadStream is not implemented for browsers");
}
export { ReadStream, WriteStream, isatty };
export default { isatty, ReadStream, WriteStream };
