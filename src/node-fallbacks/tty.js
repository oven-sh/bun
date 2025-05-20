let isatty = () => false;
function WriteStream() {
  throw new Error("tty.WriteStream is not implemented for browsers");
}
function ReadStream() {
  throw new Error("tty.ReadStream is not implemented for browsers");
}
export { ReadStream, WriteStream, isatty };
