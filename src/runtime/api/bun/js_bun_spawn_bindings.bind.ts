import * as b from "../../../codegen/bindgen-lib.ts";
import { Blob } from "../../webcore/Blob.bind.ts";
import { Request, Response } from "../../webcore/response.bind.ts";
import { BuildArtifact } from "../JSBundler.bind.ts";
import { KillSignal, Subprocess } from "./subprocess.bind.ts";
import { TerminalOptions } from "./Terminal.bind.ts";

export default b.module({ rustPath: "crate::api::js_bun_spawn_bindings" });

/** `null` is there: `stdin`, `stderr` and `stdout` are read only if `stdio` is `undefined`. */
export const SpawnStdioList = b.union({ missing: b.undefined, none: b.null, list: b.jsArray });
/** An element of `stdio`, or `stdin`, `stderr`, `stdout`. `stream` is a `ReadableStream`, or it is refused. */
export const StdioValue = b.union(
  {
    missing: b.undefined,
    ignore: b.null,
    string: b.stringLike,
    number: b.jsNumber,
    blob: Blob.withValue,
    buildArtifact: BuildArtifact.withValue,
    request: Request.withValue,
    response: Response.withValue,
    buffer: b.bufferSource.allowShared,
    stream: b.object,
    other: b.ignored,
  },
  { fromJS: true },
);
const id = b.i32.validateIntegerRange(-2147483648, 2147483647).nanAs(0).nullable;
/** A directory, open or by its path. */
export const SpawnCgroupTarget = b.union({
  fd: b.i32.validateIntegerRange(0, 2147483647).nanAs(-1),
  path: b.string.allowStringObject.utf8.owned,
});

/** `options` is also a `Terminal`. */
export const SpawnTerminal = b.union({ options: TerminalOptions, other: b.ignored });
export const SpawnOptionsObject = b.dictionary(
  {
    /** Walked by `length` and index. */
    cmd: b.opaque.emptyStringAsNull,
    argv0: b.string.loose.emptyStringAsNull,
    cwd: b.string.loose.emptyStringAsNull,
    ipc: b.callable.otherAsNull,
    serialization: b.string.allowStringObject.emptyStringAsNull,
    signal: {
      type: b.abortSignal.shared.emptyStringAsNull,
      expected: ["AbortSignal"],
    },
    onDisconnect: b.callable.emptyStringAsNull,
    onExit: b.callable.emptyStringAsNull,
    env: b.object.emptyStringAsNull,
    stdio: { type: SpawnStdioList, expected: "stdio must be an array" },
    stdin: StdioValue,
    stderr: StdioValue,
    stdout: StdioValue,
    lazy: b.bool.otherAsNull,
    detached: b.bool.otherAsNull,
    uid: id,
    gid: id,
    cgroup: { type: SpawnCgroupTarget.nullable, expected: ["string", "number"] },
    windowsHide: b.bool.otherAsNull,
    windowsVerbatimArguments: b.bool.otherAsNull,
    timeout: b.jsNumber.nullable,
    killSignal: KillSignal,
    maxBuffer: b.jsNumber.otherAsNull,
    terminal: SpawnTerminal.emptyStringAsNull,
  },
  { deferred: true, reportedAs: "" },
);
export const SpawnCommand = b.union({ list: b.jsArray, options: SpawnOptionsObject, other: b.ignored });

/** `(cmd, options?)` or `({ cmd, ..options })`. */
const spawnSignature = {
  args: { cmdOrOptions: SpawnCommand, options: SpawnOptionsObject.otherAsNull },
  returns: b.object,
  capability: "js",
  throws: true,
} as const;
export const spawn = b.fn({ ...spawnSignature, returns: Subprocess });
export const spawnSync = b.fn(spawnSignature);
