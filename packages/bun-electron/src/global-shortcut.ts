// globalShortcut — accelerator registry with Electron-compatible parsing.
//
// Actual OS-wide key capture requires platform hooks that CEF doesn't expose,
// so this manages the registration table and validates/normalizes
// accelerators; callbacks can be fired programmatically via _trigger (used by
// menu accelerators and tests).

const MODIFIERS = new Set([
  "command",
  "cmd",
  "control",
  "ctrl",
  "commandorcontrol",
  "cmdorctrl",
  "alt",
  "option",
  "altgr",
  "shift",
  "super",
  "meta",
]);

function normalizeAccelerator(accelerator: string): string {
  if (typeof accelerator !== "string" || accelerator.length === 0) {
    throw new TypeError("accelerator must be a non-empty string");
  }
  const parts = accelerator.split("+").map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) {
    throw new TypeError(`Invalid accelerator: '${accelerator}'`);
  }
  // CommandOrControl resolves to Command on macOS, Control elsewhere — same
  // as Electron — so accelerators compare equal across the alias forms.
  const commandOrControl = process.platform === "darwin" ? "command" : "control";
  const mods: string[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS.has(lower)) {
      let canonical = lower;
      if (lower === "cmd") canonical = "command";
      else if (lower === "ctrl") canonical = "control";
      else if (lower === "cmdorctrl" || lower === "commandorcontrol") canonical = commandOrControl;
      else if (lower === "option") canonical = "alt";
      else if (lower === "meta") canonical = "super";
      if (!mods.includes(canonical)) mods.push(canonical);
    } else {
      if (key !== null) {
        throw new TypeError(`Invalid accelerator: '${accelerator}' has multiple keys`);
      }
      key = lower;
    }
  }
  if (key === null) {
    throw new TypeError(`Invalid accelerator: '${accelerator}' has no key`);
  }
  return [...mods.sort(), key].join("+");
}

const registered = new Map<string, () => void>();

export const globalShortcut = {
  register(accelerator: string, callback: () => void): boolean {
    const key = normalizeAccelerator(accelerator);
    if (registered.has(key)) return false;
    registered.set(key, callback);
    return true;
  },

  registerAll(accelerators: string[], callback: () => void): void {
    for (const accelerator of accelerators) {
      const key = normalizeAccelerator(accelerator);
      if (!registered.has(key)) registered.set(key, callback);
    }
  },

  isRegistered(accelerator: string): boolean {
    return registered.has(normalizeAccelerator(accelerator));
  },

  unregister(accelerator: string): void {
    registered.delete(normalizeAccelerator(accelerator));
  },

  unregisterAll(): void {
    registered.clear();
  },

  /** @internal Fire a registered accelerator's callback (no real OS hook). */
  _trigger(accelerator: string): boolean {
    const cb = registered.get(normalizeAccelerator(accelerator));
    if (!cb) return false;
    cb();
    return true;
  },
};
