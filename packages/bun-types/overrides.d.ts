declare namespace NodeJS {
  type _BunEnv = import("bun").Env;
  interface ProcessVersions extends Dict<string> {
    bun: string;
  }
  interface ProcessEnv extends Dict<string>, _BunEnv {
    /**
     * Can be used to change the default timezone at runtime
     */
    NODE_ENV?: string;
  }
}

declare module "fs/promises" {
  import { PathLike } from "bun";
  function exists(path: PathLike): Promise<boolean>;
}

declare module "tls" {
  // eslint-disable-next-line no-duplicate-imports
  import { BunFile } from "bun";

  type BunConnectionOptions = Omit<ConnectionOptions, "ca" | "tls" | "cert"> & {
    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?:
      | string
      | Buffer
      | NodeJS.TypedArray
      | BunFile
      | Array<string | Buffer | BunFile>
      | undefined;
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
  };

  function connect(
    options: BunConnectionOptions,
    secureConnectListener?: () => void,
  ): TLSSocket;
}
