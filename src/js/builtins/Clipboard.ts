// The async Clipboard API, readText()/writeText() only: https://w3c.github.io/clipboard-apis/
// `createClipboard` runs once per realm, lazily, from `m_clipboardObjects.initLater` in
// `ZigGlobalObject.cpp`; it returns the interface object and the `[SameObject]` singleton.
export function createClipboard(EventTargetConstructor) {
  const readTextNative = $newRustFunction("clipboard.rs", "readTextNative", 0);
  const writeTextNative = $newRustFunction("clipboard.rs", "writeTextNative", 1);
  const useNative = process.platform === "darwin" || process.platform === "win32";

  function notAllowed(message: string) {
    return new DOMException(message, "NotAllowedError");
  }

  // Helper argvs for the platforms with no in-process clipboard API, gated on
  // the display server the session actually has (both lists on XWayland).
  function helperCandidates(write: boolean): string[][] {
    const cmds: string[][] = [];
    if (process.env.WAYLAND_DISPLAY) {
      // `--type text` matches any text flavour but never dumps binary, and
      // `--no-newline` stops wl-paste appending one that was never copied.
      cmds.push(
        write ? ["wl-copy", "--type", "text/plain;charset=utf-8"] : ["wl-paste", "--no-newline", "--type", "text"],
      );
    }
    if (process.env.DISPLAY) {
      cmds.push(
        write ? ["xclip", "-selection", "clipboard", "-in"] : ["xclip", "-selection", "clipboard", "-out"],
        write ? ["xsel", "--clipboard", "--input"] : ["xsel", "--clipboard", "--output"],
      );
    }
    return cmds;
  }

  // Reads and writes walk the same candidate list until one exits 0, so both
  // always reach the same clipboard. Writes never pipe stdout/stderr — the
  // helper forks a selection-owning child that inherits our fds.
  async function helperRun(write: boolean, input?: Uint8Array): Promise<string> {
    const cmds = helperCandidates(write);
    if (cmds.length === 0) {
      throw notAllowed(
        `${write ? "Writing" : "Reading"} the clipboard requires a Wayland or X11 display, but neither $WAYLAND_DISPLAY nor $DISPLAY is set.`,
      );
    }
    let spawned = 0;
    let cleanExits = 0;
    for (const cmd of cmds) {
      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn({
          cmd,
          stdin: input ?? "ignore",
          stdout: write ? "ignore" : "pipe",
          stderr: "ignore",
          // A hung X11 selection owner would otherwise block `xclip -out` forever.
          timeout: 10_000,
        });
      } catch {
        continue; // not installed
      }
      spawned++;
      const [out, code] = await Promise.all([write ? "" : proc.stdout!.text(), proc.exited]);
      if (code === 0) return out;
      // A timed-out (signal-killed) helper proves nothing about the clipboard.
      if (proc.signalCode === null) cleanExits++;
    }
    if (spawned === 0) {
      throw notAllowed(
        "No clipboard helper was found. Install `wl-clipboard` (Wayland), `xclip`, or `xsel` to use navigator.clipboard.",
      );
    }
    // The helpers use one exit code for "nothing is copied" and for any other
    // failure, so a clean non-zero read exit is treated as "no text", which
    // the spec resolves with "".
    if (!write && cleanExits > 0) return "";
    throw notAllowed(`The clipboard helper failed to ${write ? "write to" : "read"} the clipboard.`);
  }

  // WebIDL: `Clipboard` has no constructor. The flag is true only for the one
  // construction below, which also makes `this !== clipboard` a complete brand
  // check for the methods: no other instance (or subclass) can ever exist.
  let constructing = true;

  class Clipboard extends EventTargetConstructor {
    constructor() {
      if (!constructing) throw new TypeError("Illegal constructor");
      super();
    }

    // `async` so a failed brand check rejects, as WebIDL specifies for a
    // Promise-returning operation. The singleton check is a complete brand
    // check: the throwing constructor means no other instance can exist.
    async readText(): Promise<string> {
      if (this !== clipboard) throw new TypeError("Clipboard.prototype.readText called on an incompatible receiver");
      if (useNative) {
        // The native promise resolves from the work pool, so a slow
        // pasteboard owner never blocks the event loop.
        const text = await readTextNative();
        if (text === null) throw notAllowed("The system clipboard is not available.");
        return text;
      }
      return await helperRun(false);
    }

    async writeText(data): Promise<void> {
      if (this !== clipboard) throw new TypeError("Clipboard.prototype.writeText called on an incompatible receiver");
      if (arguments.length < 1)
        throw new TypeError("Clipboard.prototype.writeText requires 1 argument, but only 0 were passed");
      // WebIDL `DOMString` argument conversion (`null` → "null", Symbol
      // throws), here so it applies on every platform.
      const text = `${data}`;
      if (useNative) {
        if (!(await writeTextNative(text))) throw notAllowed("The system clipboard is not available.");
        return;
      }
      await helperRun(true, new TextEncoder().encode(text));
    }
  }

  // WebIDL: interface members are enumerable; plain JS class methods are not.
  Object.defineProperty(Clipboard.prototype, "readText", { enumerable: true });
  Object.defineProperty(Clipboard.prototype, "writeText", { enumerable: true });
  Object.defineProperty(Clipboard.prototype, Symbol.toStringTag, {
    value: "Clipboard",
    writable: false,
    enumerable: false,
    configurable: true,
  });

  const clipboard = new Clipboard();
  constructing = false;
  return { Clipboard, instance: clipboard };
}
