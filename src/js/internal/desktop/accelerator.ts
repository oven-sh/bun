// Electron's accelerators ("CmdOrCtrl+Shift+P") as `[key, modifiers]` with the key names of GPUI.
const SHIFT = 1;
const CONTROL = 2;
const ALT = 4;
const META = 8;

type Chord = [key: string, modifiers: number];

const modifiers = {
  __proto__: null,
  shift: SHIFT,
  control: CONTROL,
  ctrl: CONTROL,
  alt: ALT,
  option: ALT,
  command: META,
  cmd: META,
  super: META,
  meta: META,
  commandorcontrol: process.platform === "darwin" ? META : CONTROL,
  cmdorctrl: process.platform === "darwin" ? META : CONTROL,
  mod: process.platform === "darwin" ? META : CONTROL,
};

const keys = {
  __proto__: null,
  plus: "+",
  " ": "space",
  return: "enter",
  esc: "escape",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  contextmenu: "menu",
  numadd: "+",
  numsub: "-",
  nummult: "*",
  numdiv: "/",
  numdec: ".",
};

const named =
  /^(?:f(?:[1-9]|1\d|2[0-4])|space|tab|enter|escape|backspace|delete|insert|up|down|left|right|home|end|pageup|pagedown|menu|capslock)$/;

function keyName(key: string): string | undefined {
  const lower = key.toLowerCase();
  const name = keys[lower] ?? lower.replace(/^num(?=\d$)/, "");
  return named.test(name) || [...name].length === 1 ? name : undefined;
}

function parse(accelerator: string): Chord {
  const parts = String(accelerator).split("+");
  let last = parts.pop()!;
  if (last === "" && parts.length > 0) {
    // "Ctrl++"
    last = "+";
    parts.pop();
  }
  let bits = 0;
  for (const part of parts) {
    const bit = modifiers[part.trim().toLowerCase()];
    if (bit === undefined) throw $ERR_INVALID_ARG_VALUE("accelerator", accelerator, `has no modifier "${part}"`);
    bits |= bit;
  }
  const key = keyName(last === " " ? last : last.trim());
  if (key === undefined) throw $ERR_INVALID_ARG_VALUE("accelerator", accelerator, `has no key "${last}"`);
  return [key, bits];
}

const labels = { __proto__: null, escape: "Esc", pageup: "PgUp", pagedown: "PgDn", delete: "Del", insert: "Ins" };

function format([key, bits]: Chord): string {
  const label = labels[key] ?? key[0].toUpperCase() + key.slice(1);
  if (process.platform === "darwin") {
    return (
      (bits & CONTROL ? "⌃" : "") +
      (bits & ALT ? "⌥" : "") +
      (bits & SHIFT ? "⇧" : "") +
      (bits & META ? "⌘" : "") +
      label
    );
  }
  return (
    (bits & CONTROL ? "Ctrl+" : "") +
    (bits & ALT ? "Alt+" : "") +
    (bits & SHIFT ? "Shift+" : "") +
    (bits & META ? "Super+" : "") +
    label
  );
}

/** The syntax of the global-hotkey crate. */
function toGlobalHotkey([key, bits]: Chord): string {
  return (
    (bits & CONTROL ? "ctrl+" : "") +
    (bits & ALT ? "alt+" : "") +
    (bits & SHIFT || key === "+" ? "shift+" : "") +
    (bits & META ? "super+" : "") +
    (key === "+" ? "=" : key)
  );
}

export default { SHIFT, CONTROL, ALT, META, parse, format, keyName, toGlobalHotkey };
