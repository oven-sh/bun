declare module "tty" {
  /**
   * The `tty.isatty()` method returns `true` if the given `fd` is associated with
   * a TTY and `false` if it is not, including whenever `fd` is not a non-negative
   * integer.
   * @since v0.5.8
   * @param fd A numeric file descriptor
   */
  function isatty(fd: number): boolean;

  // TODO: tty-browserify only polyfills functions that throws errors, wouldn't make sense to have types at the moment
  var ReadStream: Function;
  var WriteStream: Function;
}
declare module "node:tty" {
  export * from "tty";
}
