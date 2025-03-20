export {};

declare module "node:trace_events" {
  export namespace constants {
    const TRACE_EVENT_PHASE_BEGIN: number;
    const TRACE_EVENT_PHASE_END: number;
    const TRACE_EVENT_PHASE_COMPLETE: number;
    const TRACE_EVENT_PHASE_INSTANT: number;
    const TRACE_EVENT_PHASE_ASYNC_BEGIN: number;
    const TRACE_EVENT_PHASE_ASYNC_STEP_INTO: number;
    const TRACE_EVENT_PHASE_ASYNC_STEP_PAST: number;
    const TRACE_EVENT_PHASE_ASYNC_END: number;
    const TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN: number;
    const TRACE_EVENT_PHASE_NESTABLE_ASYNC_END: number;
    const TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT: number;
    const TRACE_EVENT_PHASE_FLOW_BEGIN: number;
    const TRACE_EVENT_PHASE_FLOW_STEP: number;
    const TRACE_EVENT_PHASE_FLOW_END: number;
    const TRACE_EVENT_PHASE_METADATA: number;
    const TRACE_EVENT_PHASE_COUNTER: number;
    const TRACE_EVENT_PHASE_SAMPLE: number;
    const TRACE_EVENT_PHASE_CREATE_OBJECT: number;
    const TRACE_EVENT_PHASE_SNAPSHOT_OBJECT: number;
    const TRACE_EVENT_PHASE_DELETE_OBJECT: number;
    const TRACE_EVENT_PHASE_MEMORY_DUMP: number;
    const TRACE_EVENT_PHASE_MARK: number;
    const TRACE_EVENT_PHASE_CLOCK_SYNC: number;
    const TRACE_EVENT_PHASE_ENTER_CONTEXT: number;
    const TRACE_EVENT_PHASE_LEAVE_CONTEXT: number;
    const TRACE_EVENT_PHASE_LINK_IDS: number;
  }
}

declare global {
  namespace NodeJS {
    interface Process {
      readonly version: string;
      browser: boolean;

      /**
       * Whether you are using Bun
       */
      isBun: true;

      /**
       * The current git sha of Bun
       */
      revision: string;

      reallyExit(code?: number): never;
      dlopen(module: { exports: any }, filename: string, flags?: number): void;
      _exiting: boolean;
      noDeprecation: boolean;

      binding(m: "constants"): {
        os: typeof import("node:os").constants;
        fs: typeof import("node:fs").constants;
        crypto: typeof import("node:crypto").constants;
        zlib: typeof import("node:zlib").constants;
        trace: typeof import("node:trace_events").constants;
      };
      binding(m: string): object;
    }

    interface ProcessVersions extends Dict<string> {
      bun: string;
    }
  }
}

declare module "fs/promises" {
  function exists(path: Bun.PathLike): Promise<boolean>;
}

declare module "tls" {
  interface BunConnectionOptions extends Omit<ConnectionOptions, "key" | "ca" | "tls" | "cert"> {
    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?: string | Buffer | NodeJS.TypedArray | Bun.BunFile | Array<string | Buffer | Bun.BunFile> | undefined;
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
      | Bun.BunFile
      | Array<string | Buffer | NodeJS.TypedArray | Bun.BunFile>
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
      | Bun.BunFile
      | NodeJS.TypedArray
      | Array<string | Buffer | Bun.BunFile | NodeJS.TypedArray | KeyObject>
      | undefined;
  }

  function connect(options: BunConnectionOptions, secureConnectListener?: () => void): TLSSocket;
}
