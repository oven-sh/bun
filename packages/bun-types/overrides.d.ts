export {};

import type { Env, PathLike, BunFile } from "bun";
import type { Modifiers, ForegroundColors, BackgroundColors } from "util";

declare global {
  namespace NodeJS {
    interface ProcessVersions extends Dict<string> {
      bun: string;
    }
    interface ProcessEnv extends Env {}
  }
}

declare module "fs/promises" {
  function exists(path: PathLike): Promise<boolean>;
}

declare module "tls" {
  interface BunConnectionOptions extends Omit<ConnectionOptions, "key" | "ca" | "tls" | "cert"> {
    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?: string | Buffer | NodeJS.TypedArray | BunFile | Array<string | Buffer | BunFile> | undefined;
    /**
     *  Cert chains in PEM format. One cert chain should be provided per
     *  private key. Each cert chain should consist of the PEM formatted
     *  certificate for a provided private key, followed by the PEM
     *  formatted intermediate certificates (if any), in order, and not
     *  including the root CA (the root CA must be pre-known to the peer,
     *  see ca). When providing multiple cert chains, they do not have to
     *  be in the same order as their private keys in key. If the
     *  intermediate certificates are not provided, the peer will not be
     *  able to validate the certificate, and the handshake will fail.
     */
    cert?:
      | string
      | Buffer
      | NodeJS.TypedArray
      | BunFile
      | Array<string | Buffer | NodeJS.TypedArray | BunFile>
      | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys will be decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form {pem: <string|buffer>[,
     * passphrase: <string>]}. The object form can only occur in an array.
     * object.passphrase is optional. Encrypted keys will be decrypted with
     * object.passphrase if provided, or options.passphrase if it is not.
     */
    key?:
      | string
      | Buffer
      | BunFile
      | NodeJS.TypedArray
      | Array<string | Buffer | BunFile | NodeJS.TypedArray | KeyObject>
      | undefined;
  }

  function connect(options: BunConnectionOptions, secureConnectListener?: () => void): TLSSocket;
}

declare module "util" {
  /**
   * This function returns a formatted text considering the `format` passed.
   *
   * ```js
   * const { styleText } = require('node:util');
   * const errorMessage = styleText('red', 'Error! Error!');
   * console.log(errorMessage);
   * ```
   *
   * `util.inspect.colors` also provides text formats such as `italic`, and `underline` and you can combine both:
   *
   * ```js
   * console.log(
   *   util.styleText(['underline', 'italic'], 'My italic underlined message'),
   * );
   * ```
   *
   * When passing an array of formats, the order of the format applied is left to right so the following style
   * might overwrite the previous one.
   *
   * ```js
   * console.log(
   *   util.styleText(['red', 'green'], 'text'), // green
   * );
   * ```
   *
   * The full list of formats can be found in [modifiers](https://nodejs.org/docs/latest-v20.x/api/util.html#modifiers).
   * @param format A text format or an Array of text formats defined in `util.inspect.colors`.
   * @param text The text to to be formatted.
   */
  export function styleText(
    format: ForegroundColors | BackgroundColors | Modifiers | Array<ForegroundColors | BackgroundColors | Modifiers>,
    text: string,
  ): string;
}
