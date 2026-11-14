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

import { BuildError } from "./error.ts";

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
 * The argv words a compiler receives from `flags`, the text that a ninja rule
 * puts in its command (`$cxxflags`): what `/bin/sh` makes of it, or on Windows
 * what the program's own argv parsing does (`\"` and `""` are both a literal
 * quote). `compile_commands.json` holds argv, and clangd and the other readers
 * pass its `arguments` to the compiler without a shell: a `-DX=\"v\"` copied
 * there defines X as `\"v\"`, which does not compile.
 *
 * Only quoting, backslashes and whitespace are interpreted. On POSIX, `$` and
 * a backquote throw, and so does an unterminated quote on either host; glob
 * characters, `;`, `&`, `|`, `#` and `~` are kept as literal characters,
 * which is not what the shell does with them unquoted.
 */
export function shellWords(flags: readonly string[], windows: boolean): string[] {
  const words: string[] = [];
  for (const text of flags) {
    words.push(...(windows ? windowsWords(text) : posixWords(text)));
  }
  return words;
}

function posixWords(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (ch === "$" || ch === "`") {
      throw new BuildError(`shellWords: ${JSON.stringify(text)} has an expansion (${ch})`);
    }
    if (ch === "\\") {
      if (i + 1 < text.length) word += text[++i];
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new BuildError(`shellWords: unterminated ' in ${JSON.stringify(text)}`);
      word += text.slice(i + 1, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        const c = text[j];
        if (c === "$" || c === "`") {
          throw new BuildError(`shellWords: ${JSON.stringify(text)} has an expansion (${c})`);
        }
        if (c === "\\" && j + 1 < text.length && '"\\$`\n'.includes(text[j + 1]!)) {
          word += text[++j];
          continue;
        }
        word += c;
      }
      if (j >= text.length) throw new BuildError(`shellWords: unterminated " in ${JSON.stringify(text)}`);
      i = j;
      continue;
    }
    word += ch;
  }
  if (inWord) words.push(word);
  return words;
}

// The rules of LLVM's cl::TokenizeWindowsCommandLine, which clang and
// clang-cl read their command line with on Windows: 2n backslashes before `"`
// give n and toggle quoting, 2n+1 give n and a literal `"`, and `""` inside
// quotes is a literal `"`.
function windowsWords(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!quoted && (ch === " " || ch === "\t")) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (ch === "\\") {
      let n = 0;
      while (text[i + n] === "\\") n++;
      if (text[i + n] !== '"') {
        word += "\\".repeat(n);
        i += n - 1;
        continue;
      }
      word += "\\".repeat(Math.floor(n / 2));
      i += n;
      if (n % 2 === 1) {
        word += '"';
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        word += '"';
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    word += ch;
  }
  if (quoted) throw new BuildError(`shellWords: unterminated " in ${JSON.stringify(text)}`);
  if (inWord) words.push(word);
  return words;
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
