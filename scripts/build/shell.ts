/**
 * Shell argument quoting for ninja rule commands.
 *
 * Ninja executes commands via `/bin/sh -c "<command>"` on unix. On windows it
 * hands the command line to CreateProcess as-is (no shell), and the tool
 * being run splits it into argv with the Win32 rules; the few rules we wrap
 * in `cmd /c "..."` pass the text through to the tool unchanged as well.
 * Arguments with spaces/metacharacters need quoting to survive that layer.
 *
 * ## Why this is its own file
 *
 * Every module that emits ninja rules needs to quote args. Before this was
 * extracted, we had several slightly-different implementations (source.ts had
 * posix-only, codegen.ts had windows-aware, webkit.ts had posix-only
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
 * Windows (CreateProcess → the tool's own argv parsing):
 *   Double-quote, with the documented Win32 argv rules: an embedded `"`
 *   becomes `\"`, and a run of backslashes is doubled when it sits in front
 *   of a `"` (ours or an embedded one), since only there is `\` an escape.
 *   This is what the MS CRT, CommandLineToArgvW, LLVM's tokenizer and ninja's
 *   own $in/$out escaping all implement. The alternative `""` spelling is
 *   not interpreted consistently: ccache 4.12, for one, ends the quoted span
 *   at `""`, so an argument holding both a quote and a space (a define whose
 *   value is a path) splits in two on its way to clang-cl.
 *
 *   Known cmd footguns we DON'T handle for the `cmd /c`-wrapped rules:
 *   `%VAR%` expansion, `^` escape, `&`/`|`/`>` redirection. In practice the
 *   args those rules see are paths + flag values; we'd hit this only with
 *   very weird file names. If it happens: switch the affected rule to invoke
 *   via powershell instead of cmd.
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
 * @param windows If true, use Win32 argv quoting (`"..."`, `\"`). If false,
 *   posix (`'`). Pass the HOST's os: the host is what runs the command.
 */
export function quote(arg: string, windows: boolean): string {
  // Fast path: safe characters only, no quoting needed. Keeps the .ninja
  // file legible for the common case (paths without spaces, flag values).
  // `\` is safe on windows outside quotes (it only escapes a following `"`,
  // and `"` is not in this set) — and posix paths never contain it, so
  // including it doesn't affect the posix branch.
  if (/^[A-Za-z0-9_@%+=:,./\\\-]+$/.test(arg)) {
    return arg;
  }
  if (windows) {
    return quoteWin32(arg);
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function quoteWin32(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      // The backslashes now precede a quote, so each one needs escaping
      // itself, and then the quote does too.
      out += "\\".repeat(backslashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  // A trailing run would otherwise escape our closing quote.
  return out + "\\".repeat(backslashes * 2) + '"';
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
