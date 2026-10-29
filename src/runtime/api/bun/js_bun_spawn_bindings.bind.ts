import * as b from "../../../codegen/bindgen-lib.ts";
import { KillSignal, Subprocess } from "./subprocess.bind.ts";
import { Terminal, TerminalOptions } from "./Terminal.bind.ts";

export default b.module({ rustPath: "crate::api::js_bun_spawn_bindings" });

const id = b.i32.validateIntegerRange().nanAs(0).nullable;
/** A directory, open or by its path. */
export const SpawnCgroupTarget = b.union({
  fd: b.i32.validateIntegerRange(0, 2 ** 31 - 1).nanAs(-1),
  path: b.string.allowStringObject.utf8.owned,
});

export const SpawnTerminal = b.union({ terminal: Terminal.withValue, options: TerminalOptions, other: b.ignored });
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
    stdio: b.opaque.optional,
    stdin: b.opaque.optional,
    stderr: b.opaque.optional,
    stdout: b.opaque.optional,
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
