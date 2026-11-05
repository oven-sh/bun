import { a } from "./a";
export function f() {
  const s = "}" + "{" + `}${a}{${`{`}`; /* } */ // }
  return /[/}]\}/.test(s) ? a / 2 : a++ / 2;
}
export const after = 1;
