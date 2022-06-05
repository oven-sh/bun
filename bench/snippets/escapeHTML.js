import { group } from "mitata";
import { bench, run } from "mitata";

var bunEscapeHTML_ = globalThis.escapeHTML || Bun.escapeHTML;
var bunEscapeHTML = function (str) {
  if (str.length === 1) {
    switch (str.charCodeAt(0)) {
      case 34: // "
        return "&quot;";
      case 38: // &
        return "&amp;";
      case 39: // '
        return "&#x27;"; // modified from escape-html; used to be '&#39'
      case 60: // <
        return "&lt;";
      case 62: // >
        return "&gt;";
      default:
        return str;
    }
  }

  return bunEscapeHTML_(str);
};

const matchHtmlRegExp = /["'&<>]/;

/**
 * Escapes special characters and HTML entities in a given html string.
 *
 * @param  {string} string HTML string to escape for later insertion
 * @return {string}
 * @public
 */

const FIXTURE = require("fs")
  .readFileSync(import.meta.dir + "/_fixture.txt", "utf8")
  .split("")
  .map((a) => {
    if (a.charCodeAt(0) > 127) {
      return "a";
    }
    return a;
  })
  .join("");

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

for (let input of [
  // " ",
  // "<script>alert('xss')</script>",
  // "hello world",
  // "hello world<script>alert('xss')</script>",
  // "<",
  // ">",
  // `short value`,
  `nothing to escape `.repeat(99999),
  FIXTURE,
]) {
  group(
    {
      summary: true,
      name: `"` + input.substring(0, Math.min(input.length, 32)) + `"`,
    },
    () => {
      bench(`react's escapeHTML`, () => reactEscapeHtml(input));

      bench(`bun's escapeHTML`, () => bunEscapeHTML(input));
    }
  );
}

await run();
