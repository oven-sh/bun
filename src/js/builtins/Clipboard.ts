// The async Clipboard API (https://w3c.github.io/clipboard-apis/), built once
// per realm from `m_clipboardObjects.initLater` in `ZigGlobalObject.cpp`,
// which hands in the real `EventTarget` and `Event` constructors.
export function createClipboard(EventTargetConstructor, EventConstructor) {
  const readTextNative = $newRustFunction("clipboard.rs", "readTextNative", 0);
  const writeTextNative = $newRustFunction("clipboard.rs", "writeTextNative", 1);
  const readTypesNative = $newRustFunction("clipboard.rs", "readTypesNative", 1);
  const writeTypesNative = $newRustFunction("clipboard.rs", "writeTypesNative", 2);
  const useNative = process.platform === "darwin" || process.platform === "win32";

  // The representations this build can put on / take off the OS clipboard;
  // `src/runtime/webcore/clipboard.rs` must map every entry, and on the
  // helper platforms every non-text entry needs a `-t`-capable helper.
  const SUPPORTED_TYPES =
    process.platform === "win32" ? ["text/plain", "image/png"] : ["text/plain", "text/html", "image/png"];

  // The capability gate for supports()/read()/write(); a plain loop so no
  // user-patchable Array.prototype method is consulted.
  function isSupported(type: unknown): boolean {
    for (let i = 0; i < SUPPORTED_TYPES.length; i++) {
      if (SUPPORTED_TYPES[i] === type) return true;
    }
    return false;
  }

  function notAllowed(message: string) {
    return new DOMException(message, "NotAllowedError");
  }

  // ─── posix-with-a-display-server fallback ────────────────────────────────

  // Helper argvs for the platforms with no in-process clipboard API, gated on
  // the display server the session actually has (both lists on XWayland).
  // `xsel` is text-only, so it is only a candidate for `text/plain`.
  function helperCandidates(write: boolean, mime: string): string[][] {
    const cmds: string[][] = [];
    const text = mime === "text/plain";
    if (process.env.WAYLAND_DISPLAY) {
      // `--type text` matches any text flavour but never dumps binary, and
      // `--no-newline` stops wl-paste appending one that was never copied.
      cmds.push(
        write
          ? ["wl-copy", "--type", text ? "text/plain;charset=utf-8" : mime]
          : ["wl-paste", "--no-newline", "--type", text ? "text" : mime],
      );
    }
    if (process.env.DISPLAY) {
      const xclipType = text ? [] : ["-t", mime];
      cmds.push(
        write
          ? ["xclip", "-selection", "clipboard", ...xclipType, "-in"]
          : ["xclip", "-selection", "clipboard", ...xclipType, "-out"],
      );
      if (text) cmds.push(write ? ["xsel", "--clipboard", "--input"] : ["xsel", "--clipboard", "--output"]);
    }
    return cmds;
  }

  // Reads and writes walk the same candidate list until one exits 0, so both
  // always reach the same clipboard. Writes never pipe stdout/stderr — the
  // helper forks a selection-owning child that inherits our fds.
  async function helperRun(
    write: boolean,
    input: Uint8Array | undefined,
    mime: string,
    binary: boolean,
  ): Promise<string | Uint8Array> {
    const cmds = helperCandidates(write, mime);
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
      const [out, code] = await Promise.all([
        write ? "" : binary ? proc.stdout!.bytes() : proc.stdout!.text(),
        proc.exited,
      ]);
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
    // failure, so a clean non-zero read exit is treated as "no data", which
    // the spec maps to an empty result rather than an error.
    if (!write && cleanExits > 0) return binary ? new Uint8Array(0) : "";
    throw notAllowed(`The clipboard helper failed to ${write ? "write to" : "read"} the clipboard.`);
  }

  // ─── ClipboardItem ───────────────────────────────────────────────────────

  function isValidType(type: unknown): type is string {
    if (typeof type !== "string" || type.length === 0) return false;
    const slash = type.indexOf("/");
    return slash > 0 && slash === type.lastIndexOf("/") && slash < type.length - 1 && !type.includes(" ");
  }

  // The `$clipboardItemState` private slot is the brand: only objects built
  // by this constructor have it, it is unreachable from user code, and the
  // accessors throw for any receiver without it.
  class ClipboardItem {
    constructor(items, options) {
      // WebIDL: `record<DOMString, ClipboardItemData>` requires an object.
      if (items === null || typeof items !== "object") {
        throw new TypeError("ClipboardItem requires a record of MIME type to data");
      }
      const types: string[] = [];
      // A null-prototype record keyed by MIME type, so lookups never consult
      // user-patchable prototype machinery.
      const data = { __proto__: null };
      for (const type of Object.keys(items)) {
        if (!isValidType(type)) throw new TypeError(`"${type}" is not a valid MIME type`);
        types.push(type);
        // string | Blob | Promise thereof, resolved lazily in getType().
        data[type] = items[type];
      }
      // Spec: an empty items record is a TypeError.
      if (types.length === 0) throw new TypeError("ClipboardItem requires at least one MIME type");
      const style =
        options === undefined || options === null ? "unspecified" : (options.presentationStyle ?? "unspecified");
      if (style !== "unspecified" && style !== "inline" && style !== "attachment") {
        throw new TypeError(`"${style}" is not a valid value for presentationStyle`);
      }
      $putByIdDirectPrivate(this, "clipboardItemState", { types: Object.freeze(types), data, style });
    }

    get types(): readonly string[] {
      const state = $getByIdDirectPrivate(this, "clipboardItemState");
      if (!state) throw new TypeError("ClipboardItem.prototype.types called on an incompatible receiver");
      return state.types;
    }

    get presentationStyle(): string {
      const state = $getByIdDirectPrivate(this, "clipboardItemState");
      if (!state) throw new TypeError("ClipboardItem.prototype.presentationStyle called on an incompatible receiver");
      return state.style;
    }

    async getType(type): Promise<Blob> {
      const state = $getByIdDirectPrivate(this, "clipboardItemState");
      if (!state) throw new TypeError("ClipboardItem.prototype.getType called on an incompatible receiver");
      if (arguments.length < 1) throw new TypeError("ClipboardItem.prototype.getType requires 1 argument");
      type = `${type}`;
      if (!(type in state.data)) throw new DOMException(`The type "${type}" was not found`, "NotFoundError");
      const value = await state.data[type];
      // Per spec the resolved Blob carries the requested type; strings and
      // Blobs of a different declared type are (re)wrapped. Blob normalizes
      // `text/*` to `…;charset=utf-8`, so that form already matches.
      if ($inheritsBlob(value) && (value.type === type || value.type.startsWith(`${type};`))) return value;
      if (typeof value === "string" || $inheritsBlob(value)) return new Blob([value], { type });
      throw new TypeError(`The data for "${type}" is not a string or a Blob`);
    }

    // Per-platform truth used by both `read()` and `write()`. The spec's
    // "web "-prefixed custom formats are not supported.
    static supports(type): boolean {
      return isSupported(type);
    }
  }

  // ─── ClipboardEvent ──────────────────────────────────────────────────────
  // The class only: a server runtime has no document, focus, or user gesture,
  // so nothing ever fires `copy`/`cut`/`paste` — synthetic events can still be
  // constructed and dispatched. Without `DataTransfer`, `clipboardData` is null.
  class ClipboardEvent extends EventConstructor {
    constructor(type, eventInitDict) {
      if (arguments.length < 1) throw new TypeError("ClipboardEvent requires a type argument");
      super(type, eventInitDict);
      $putByIdDirectPrivate(this, "clipboardEventBrand", true);
    }

    get clipboardData(): null {
      if (!$getByIdDirectPrivate(this, "clipboardEventBrand")) {
        throw new TypeError("ClipboardEvent.prototype.clipboardData called on an incompatible receiver");
      }
      return null;
    }
  }

  // ─── Clipboard ───────────────────────────────────────────────────────────

  // WebIDL: `Clipboard` has no constructor. The flag is true only for the one
  // construction below, which also makes `this !== clipboard` a complete brand
  // check for the methods: no other instance (or subclass) can ever exist.
  let constructing = true;

  class Clipboard extends EventTargetConstructor {
    constructor() {
      if (!constructing) throw new TypeError("Illegal constructor");
      super();
    }

    // The methods are `async` so a failed brand check *rejects* instead of
    // throwing synchronously, which is what WebIDL specifies for a
    // Promise-returning operation.
    async readText(): Promise<string> {
      if (this !== clipboard) throw new TypeError("Clipboard.prototype.readText called on an incompatible receiver");
      if (useNative) {
        // The native promise resolves from the work pool, so a slow
        // pasteboard owner never blocks the event loop.
        const text = await readTextNative();
        if (text === null) throw notAllowed("The system clipboard is not available.");
        return text;
      }
      return (await helperRun(false, undefined, "text/plain", false)) as string;
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
      await helperRun(true, new TextEncoder().encode(text), "text/plain", false);
    }

    async read(): Promise<ClipboardItem[]> {
      if (this !== clipboard) throw new TypeError("Clipboard.prototype.read called on an incompatible receiver");
      let slots: (Uint8Array | string | null)[];
      if (useNative) {
        // One native call reads every supported representation in one
        // work-pool job, serialized against our other clipboard jobs.
        slots = await readTypesNative(SUPPORTED_TYPES);
        if (slots === null) throw notAllowed("The system clipboard is not available.");
      } else {
        // Probe the types concurrently. A type with no usable helper is just
        // an absent representation, but text/plain failing means the
        // clipboard itself is unreachable (no display or nothing installed).
        slots = await Promise.all(
          SUPPORTED_TYPES.map(async type => {
            try {
              return (await helperRun(false, undefined, type, true)) as Uint8Array;
            } catch (error) {
              if (type === "text/plain") throw error;
              return null;
            }
          }),
        );
      }
      const present = { __proto__: null };
      let found = 0;
      for (let i = 0; i < SUPPORTED_TYPES.length; i++) {
        const bytes = slots[i];
        if (bytes !== null && bytes.length > 0) {
          present[SUPPORTED_TYPES[i]] = new Blob([bytes], { type: SUPPORTED_TYPES[i] });
          found++;
        }
      }
      return found > 0 ? [new ClipboardItem(present)] : [];
    }

    async write(data): Promise<void> {
      if (this !== clipboard) throw new TypeError("Clipboard.prototype.write called on an incompatible receiver");
      if (arguments.length < 1)
        throw new TypeError("Clipboard.prototype.write requires 1 argument, but only 0 were passed");
      // WebIDL `sequence<ClipboardItem>` conversion: any iterable, then a
      // per-element brand check (the private state slot is the brand).
      const items: ClipboardItem[] = [...data];
      for (const item of items) {
        if (!$getByIdDirectPrivate(item, "clipboardItemState")) {
          throw new TypeError("Clipboard.prototype.write expects a sequence of ClipboardItem");
        }
      }
      if (items.length === 0) return;
      if (items.length > 1) throw notAllowed("Writing multiple ClipboardItems is not supported.");
      const item = items[0];
      const types = item.types;
      // Per spec, a representation the implementation cannot write rejects
      // the whole write, before anything is written.
      for (const type of types) {
        if (!isSupported(type)) throw notAllowed(`The type "${type}" is not supported on this platform.`);
      }
      // Resolve every representation before the first byte is written, so a
      // rejecting ClipboardItemData promise cannot leave a partial write.
      const blobs = await Promise.all(types.map(type => item.getType(type)));
      if (useNative) {
        const buffers = await Promise.all(blobs.map(async blob => new Uint8Array(await blob.arrayBuffer())));
        if (!(await writeTypesNative(types, buffers))) {
          throw notAllowed("The system clipboard is not available.");
        }
        return;
      }
      // The helpers can only own one representation at a time, so only the
      // first one is written (a documented platform limitation).
      await helperRun(true, new Uint8Array(await blobs[0].arrayBuffer()), types[0], false);
    }
  }

  // WebIDL: interface members are enumerable; plain JS class members are not.
  for (const name of ["readText", "writeText", "read", "write"]) {
    Object.defineProperty(Clipboard.prototype, name, { enumerable: true });
  }
  for (const name of ["getType", "types", "presentationStyle"]) {
    Object.defineProperty(ClipboardItem.prototype, name, { enumerable: true });
  }
  Object.defineProperty(ClipboardItem, "supports", { enumerable: true });
  Object.defineProperty(ClipboardEvent.prototype, "clipboardData", { enumerable: true });
  const tag = (proto, value) =>
    Object.defineProperty(proto, Symbol.toStringTag, { value, writable: false, enumerable: false, configurable: true });
  tag(Clipboard.prototype, "Clipboard");
  tag(ClipboardItem.prototype, "ClipboardItem");
  tag(ClipboardEvent.prototype, "ClipboardEvent");

  const clipboard = new Clipboard();
  constructing = false;

  return { Clipboard, ClipboardItem, ClipboardEvent, instance: clipboard };
}
