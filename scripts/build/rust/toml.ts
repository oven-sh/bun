/**
 * A small TOML reader — enough of TOML 1.0 for Cargo manifests (tables, arrays
 * of tables, dotted/quoted keys, basic/literal/multi-line strings, integers,
 * floats, booleans, arrays, inline tables; no datetimes). Used by the Rust
 * planner to read the one thing cargo's JSON interfaces don't export: the
 * `[lints]` / `[workspace.lints]` tables.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export function parseToml(src: string, file = "<toml>"): TomlTable {
  let i = 0;
  // Tables are null-prototype objects: manifest keys like `constructor` must not meet Object.prototype.
  const table0 = (): TomlTable => Object.create(null) as TomlTable;
  const root: TomlTable = table0();
  let table: TomlTable = root;

  const fail = (msg: string): never => {
    const line = src.slice(0, i).split("\n").length;
    throw new Error(`${file}:${line}: ${msg}`);
  };
  const skipSpace = () => {
    while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  };
  const skipComment = () => {
    if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++;
  };
  /** Whitespace, newlines and comments (inside arrays / between statements). */
  const skipBlank = () => {
    for (;;) {
      skipSpace();
      if (src[i] === "#") skipComment();
      else if (src[i] === "\n" || src[i] === "\r") i++;
      else return;
    }
  };
  const keyPart = (): string => {
    skipSpace();
    if (src[i] === '"' || src[i] === "'") return string();
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i, i + 256));
    if (!m) fail("expected a key");
    i += m![0].length;
    return m![0];
  };
  const key = (): string[] => {
    const parts = [keyPart()];
    for (;;) {
      skipSpace();
      if (src[i] !== ".") return parts;
      i++;
      parts.push(keyPart());
    }
  };
  const string = (): string => {
    const q = src[i]!;
    const multi = src.startsWith(q + q + q, i);
    i += multi ? 3 : 1;
    if (multi && src[i] === "\n") i++;
    else if (multi && src.startsWith("\r\n", i)) i += 2;
    let out = "";
    for (;;) {
      if (i >= src.length) fail("unterminated string");
      if (multi ? src.startsWith(q + q + q, i) : src[i] === q) {
        i += multi ? 3 : 1;
        // up to two extra quotes may precede the closing delimiter of a multi-line string
        while (multi && src[i] === q) {
          out += q;
          i++;
        }
        return out;
      }
      const c = src[i]!;
      if (!multi && (c === "\n" || c === "\r")) fail("newline in string");
      if (q === '"' && c === "\\") {
        const e = src[i + 1];
        i += 2;
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === '"') out += '"';
        else if (e === "\\") out += "\\";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "u" || e === "U") {
          const n = e === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(src.slice(i, i + n), 16));
          i += n;
        } else if (e === "\n" || e === "\r" || e === " " || e === "\t") {
          // line-ending backslash: trim whitespace up to the next non-blank
          while (i < src.length && /[ \t\r\n]/.test(src[i]!)) i++;
        } else fail(`bad escape \\${e}`);
      } else {
        out += c;
        i++;
      }
    }
  };
  const value = (): TomlValue => {
    skipSpace();
    const c = src[i];
    if (c === '"' || c === "'") return string();
    if (c === "[") {
      i++;
      const arr: TomlValue[] = [];
      for (;;) {
        skipBlank();
        if (src[i] === "]") {
          i++;
          return arr;
        }
        arr.push(value());
        skipBlank();
        if (src[i] === ",") i++;
        else if (src[i] !== "]") fail("expected , or ] in array");
      }
    }
    if (c === "{") {
      i++;
      const t: TomlTable = table0();
      skipSpace();
      if (src[i] === "}") {
        i++;
        return t;
      }
      for (;;) {
        const k = key();
        skipSpace();
        if (src[i] !== "=") fail("expected = in inline table");
        i++;
        assign(t, k, value());
        skipSpace();
        if (src[i] === ",") {
          i++;
          skipSpace();
          continue;
        }
        if (src[i] === "}") {
          i++;
          return t;
        }
        fail("expected , or } in inline table");
      }
    }
    if (src.startsWith("true", i) && !/[A-Za-z0-9_-]/.test(src[i + 4] ?? "")) {
      i += 4;
      return true;
    }
    if (src.startsWith("false", i) && !/[A-Za-z0-9_-]/.test(src[i + 5] ?? "")) {
      i += 5;
      return false;
    }
    const m = /^[+-]?(0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|[0-9_]+(\.[0-9_]+)?([eE][+-]?[0-9_]+)?)/.exec(
      src.slice(i, i + 64),
    );
    if (!m) fail("expected a value");
    i += m![0].length;
    const lit = m![0].replace(/_/g, "");
    if (/^[+-]?0x/.test(lit)) return parseInt(lit.replace("0x", ""), 16);
    if (/^[+-]?0o/.test(lit)) return parseInt(lit.replace("0o", ""), 8);
    if (/^[+-]?0b/.test(lit)) return parseInt(lit.replace("0b", ""), 2);
    return Number(lit);
  };
  /** Walk/create nested tables for a dotted key and set the leaf. */
  const assign = (t: TomlTable, k: string[], v: TomlValue) => {
    let cur = t;
    for (const part of k.slice(0, -1)) {
      const next = Object.hasOwn(cur, part) ? cur[part] : undefined;
      if (next === undefined) cur = cur[part] = table0();
      else if (typeof next === "object" && !Array.isArray(next)) cur = next;
      else fail(`key ${k.join(".")} conflicts with a non-table value`);
    }
    const leaf = k[k.length - 1]!;
    if (Object.hasOwn(cur, leaf)) fail(`duplicate key ${k.join(".")}`);
    cur[leaf] = v;
  };
  const descend = (k: string[], arrayOfTables: boolean): TomlTable => {
    let cur = root;
    k.forEach((part, idx) => {
      const last = idx === k.length - 1;
      let next = Object.hasOwn(cur, part) ? cur[part] : undefined;
      if (last && arrayOfTables) {
        if (next === undefined) next = cur[part] = [];
        if (!Array.isArray(next)) return fail(`[[${k.join(".")}]] conflicts with a non-array`);
        const t: TomlTable = table0();
        next.push(t);
        cur = t;
        return;
      }
      if (next === undefined) next = cur[part] = table0();
      if (Array.isArray(next)) {
        const lastElem = next[next.length - 1];
        if (typeof lastElem !== "object" || Array.isArray(lastElem)) return fail(`[${k.join(".")}]: not a table`);
        cur = lastElem;
      } else if (typeof next === "object") cur = next;
      else fail(`[${k.join(".")}] conflicts with a non-table value`);
    });
    return cur;
  };

  for (;;) {
    skipBlank();
    if (i >= src.length) return root;
    if (src[i] === "[") {
      const aot = src[i + 1] === "[";
      i += aot ? 2 : 1;
      const k = key();
      skipSpace();
      if (aot ? !src.startsWith("]]", i) : src[i] !== "]") fail("expected ] after table name");
      i += aot ? 2 : 1;
      table = descend(k, aot);
    } else {
      const k = key();
      skipSpace();
      if (src[i] !== "=") fail("expected =");
      i++;
      assign(table, k, value());
    }
    skipSpace();
    skipComment();
    if (i < src.length && src[i] !== "\n" && src[i] !== "\r") fail("expected end of line");
  }
}
