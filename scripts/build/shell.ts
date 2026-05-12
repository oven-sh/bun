/**
 * Shell argument quoting for ninja rule commands.
 *
 * Ninja executes commands via `/bin/sh -c "<command>"` on unix and
 * `cmd /c "<command>"` on windows (when we wrap it that way in rules).
 * Arguments with spaces/metacharacters need quoting to survive that layer.
 *
 * ## Why this is its own file
 *
 * Every module that emits ninja rules needs to quote args. Before this was
 * extracted, we had four slightly-different implementations (source.ts had
 * posix-only, codegen.ts had windows-aware, webkit.ts/zig.ts had posix-only
 * copies). One implementation, consistently applied, prevents the "works on
 * my machine but not CI" class of bug where a path with a space breaks only
 * one ninja rule.
 *
 * ## Quoting rules
 *
 * POSIX (`/bin/sh`):
 *   Single-quote the whole thing. Embedded `'` becomes `'\''` (close quote,
 *   escaped quote, reopen quote). Handles every metachar including `$`, `|`,
 *   backticks, etc.
 *
 * Windows (`cmd /c`):
 *   Double-quote. Embedded `"` becomes `""`. This is cmd's escape convention,
 *   NOT the C argv convention (`\"`). The distinction matters: if the inner
 *   executable parses argv itself (most .exe do), cmd unwraps one layer of
 *   `""` but passes the rest through, so the inner program sees a literal `"`.
 *   Good enough for paths and values; breaks if you need to nest three layers
 *   of quoting (you shouldn't).
 *
 *   Known cmd footguns we DON'T handle: `%VAR%` expansion, `^` escape,
 *   `&`/`|`/`>` redirection. If an argument contains these, double-quoting
 *   protects SOME but not all. In practice our args are paths + flag values;
 *   we'd hit this only with very weird file names. If it happens: switch the
 *   affected rule to invoke via powershell instead of cmd.
 *
 * ## Safe chars (no quoting needed)
 *
 * Letters, digits, and a small set of punctuation that's unambiguous on both
 * platforms. Keeping safe-chars unquoted makes build.ninja readable — you can
 * see `-DFOO=bar` instead of `'-DFOO=bar'`.
 */

/**
 * Quote a single argument for a shell command.
 *
 * @param windows If true, use cmd.exe quoting (`""`). If false, posix (`'`).
 *   Pass `cfg.windows` from the build config.
 */
export function quote(arg: string, windows: boolean): string {
  // Fast path: safe characters only, no quoting needed. Keeps the .ninja
  // file legible for the common case (paths without spaces, flag values).
  // `\` is safe in cmd (not a metachar) — and posix paths never contain
  // it, so including it doesn't affect the posix branch.
  if (/^[A-Za-z0-9_@%+=:,./\\\-]+$/.test(arg)) {
    return arg;
  }
  if (windows) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote an array of arguments and join with spaces.
 *
 * Convenience for the common "I have argv[] and want a shell command string"
 * case — which is basically every ninja rule args var.
 */
export function quoteArgs(args: string[], windows: boolean): string {
  return args.map(a => quote(a, windows)).join(" ");
}

/**
 * Convert backslashes to forward slashes.
 *
 * Use when a path will be embedded in a sink that interprets `\` as an
 * escape character:
 *
 * - **CMake -D values**: cmake may write the value verbatim into a generated
 *   .cmake file, then re-parse it — `\U` in `C:\Users\...` becomes an
 *   invalid escape. Forward slashes are cmake's native format.
 *
 * - **C/C++ string literal defines**: `-DFOO=\"C:\Users\..\"` puts the path
 *   in a `#define` that becomes a string literal at use site. `\U` →
 *   unicode escape error, `\b`/`\n` → wrong bytes.
 *
 * Windows file APIs accept forward slashes, so this is safe for any path
 * that ends up at CreateFile/fopen. It's NOT safe for paths passed to
 * cmd.exe built-ins (cd, del) — those require backslashes — but we avoid
 * those anyway.
 *
 * No-op on posix paths (no backslashes to replace).
 */
export function slash(path: string): string {
  return path.replace(/\\/g, "/");
}
