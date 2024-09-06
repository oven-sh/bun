import { bench, group, run } from "./runner.mjs";

var bunEscapeHTML = globalThis.escapeHTML || Bun.escapeHTML;

const FIXTURE = require("fs")
  .readFileSync(import.meta.dir + "/_fixture.txt", "utf8")
  .split("")
  .map(a => {
    if (a.charCodeAt(0) > 127) {
      return "a";
    }
    return a;
  })
  .join("");

const FIXTURE_WITH_UNICODE = require("fs").readFileSync(import.meta.dir + "/_fixture.txt", "utf8");

// from react-dom:
const matchHtmlRegExp = /["'&<>]/;

function reactEscapeHtml(string) {
  const str = "" + string;
  const match = matchHtmlRegExp.exec(str);

  if (!match) {
    return str;
  }

  let escape;
  let html = "";
  let index;
  let lastIndex = 0;

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = "&quot;";
        break;
      case 38: // &
        escape = "&amp;";
        break;
      case 39: // '
        escape = "&#x27;"; // modified from escape-html; used to be '&#39'
        break;
      case 60: // <
        escape = "&lt;";
        break;
      case 62: // >
        escape = "&gt;";
        break;
      default:
        continue;
    }

    if (lastIndex !== index) {
      html += str.substring(lastIndex, index);
    }

    lastIndex = index + 1;
    html += escape;
  }

  return lastIndex !== index ? html + str.substring(lastIndex, index) : html;
}

// for (let input of [
//   "<script>alert('xss')</script>",
// `long string, nothing to escape... `.repeat(9999),
//   `long utf16 string, no esc 🤔🤔🤔🤔🤔` + "tex".repeat(4000),
//   `smol`,
//   // `medium string with <script>alert('xss')</script>`,

//   FIXTURE,
//   // "[unicode]" + FIXTURE_WITH_UNICODE,
// ]) {
//   group(
//     {
//       summary: true,
//       name:
//         `"` +
//         input.substring(0, Math.min(input.length, 32)) +
//         `"` +
//         ` (${input.length} chars)`,
//     },
//     () => {
//       bench(`ReactDOM.escapeHTML`, () => reactEscapeHtml(input));
//       bench(`html-entities.encode`, () => htmlEntityEncode(input));
//       bench(`he.escape`, () => heEscape(input));
//       bench(`Bun.escapeHTML`, () => bunEscapeHTML(input));
//     }
//   );
// }

for (let input of [
  `long string, nothing to escape... `.repeat(9999999 * 3),
  FIXTURE.repeat(8000),
  // "[unicode]" + FIXTURE_WITH_UNICODE,
]) {
  group(
    {
      summary: true,
      name:
        `"` +
        input.substring(0, Math.min(input.length, 32)) +
        `"` +
        ` (${new Intl.NumberFormat().format(input.length / 100_000_000_0)} GB)`,
    },
    () => {
      // bench(`ReactDOM.escapeHTML`, () => reactEscapeHtml(input));
      // bench(`html-entities.encode`, () => htmlEntityEncode(input));
      // bench(`he.escape`, () => heEscape(input));
      bench(`Bun.escapeHTML`, () => bunEscapeHTML(input));
    },
  );
}
await run();
