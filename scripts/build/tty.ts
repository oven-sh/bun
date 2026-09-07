/**
 * Terminal output helpers. All ANSI escapes go through here — callers
 * never check `isatty` or splice `\x1b[` themselves.
 *
 * Computed once at import. stderr is the reference fd since all our
 * progress/status output goes there (stdout is reserved for the
 * program's actual output in `bd` mode).
 */

import { isatty } from "node:tty";

/**
 * True when stderr is a terminal a human is watching — enables ANSI
 * colors, cursor control, and live FD3 streaming. False for pipes,
 * files, and CI log capture.
 */
export const interactive: boolean = isatty(2);

const useColor = interactive && (globalThis.Bun?.enableANSIColors ?? true);

export const dim = (s: string): string => (useColor ? `\x1b[2m${s}\x1b[22m` : s);
export const cyan = (s: string): string => (useColor ? `\x1b[36m${s}\x1b[39m` : s);
export const green = (s: string): string => (useColor ? `\x1b[32m${s}\x1b[39m` : s);
export const red = (s: string): string => (useColor ? `\x1b[31m${s}\x1b[39m` : s);

/**
 * Hash a name to a stable 256-color. Same name → same color across runs,
 * so `[tinycc]` in stream output and `tinycc` in the done line match.
 * zig overridden to brand orange.
 *
 * `color` defaults to this module's stderr-TTY check. stream.ts passes
 * its own — it writes to FD 3 (a terminal when set up by build.ts) while
 * its FD 2 is a ninja pipe, so the default check would wrongly disable.
 */
export function nameColor(name: string, text: string = name, color: boolean = useColor): string {
  if (!color) return text;
  const overrides: Record<string, number> = { zig: 214 };
  const palette = [220, 184, 154, 120, 114, 86, 87, 81, 111, 147, 141, 183];
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const c = overrides[name] ?? palette[(h >>> 0) % palette.length];
  return `\x1b[38;5;${c}m${text}\x1b[39m`;
}

/**
 * Write a status line to stderr. In a terminal, clears the current line
 * first (erases ninja's [N/M] progress or stream.ts prefixes that may be
 * sitting there). In a pipe, just writes.
 */
export function status(line: string): void {
  process.stderr.write(interactive ? `\r\x1b[K${line}\n` : `${line}\n`);
}
