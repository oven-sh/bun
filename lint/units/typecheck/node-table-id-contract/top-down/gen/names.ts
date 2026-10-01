// The snake_case rule of the port: JSDoc and JSX are one word, a run of capitals is one word.
export function snake(name: string): string {
  const s = name.replace(/JSDoc/g, "Jsdoc").replace(/JSX/g, "Jsx");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const isUp = c >= "A" && c <= "Z";
    if (isUp && i > 0) {
      const p = s[i - 1];
      const n = s[i + 1];
      const pLowOrDigit = (p >= "a" && p <= "z") || (p >= "0" && p <= "9");
      const pUp = p >= "A" && p <= "Z";
      const nLow = n !== undefined && n >= "a" && n <= "z";
      if (pLowOrDigit || (pUp && nLow)) out += "_";
    }
    out += c.toLowerCase();
  }
  return out;
}
// A Go field or method name as a Rust identifier. `Type` is the one name that is a Rust keyword.
export function rustName(goName: string): string {
  const s = snake(goName);
  return s === "type" ? "type_node" : s;
}
