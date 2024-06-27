const util = require("node:util");

class ErrnoException extends Error {
  /**
   * @param {number} err - A libuv error number
   * @param {string} syscall
   * @param {string} [original] err
   */
  constructor(err, syscall, original) {
    // TODO(joyeecheung): We have to use the type-checked
    // getSystemErrorName(err) to guard against invalid arguments from users.
    // This can be replaced with [ code ] = errmap.get(err) when this method
    // is no longer exposed to user land.
    const code = util.getSystemErrorName(err.errno);
    const message = original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`;

    super(message);

    this.errno = err;
    this.code = code;
    this.syscall = syscall;
  }

  // get ["constructor"]() {
  //   return Error;
  // }
}

export default {
  ErrnoException,
};
