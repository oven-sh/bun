let isatty = () => false;
function WriteStream() {
  throw new Error("tty.WriteStream is not implemented for browsers");
}
function ReadStream() {
  throw new Error("tty.ReadStream is not implemented for browsers");
}
const tty = { ReadStream, WriteStream, isatty };
export { ReadStream, WriteStream, isatty, tty as "module.exports" };
export default tty;
