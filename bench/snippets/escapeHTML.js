import { group } from "mitata";
import { bench, run } from "mitata";

var bunEscapeHTML = Bun.escapeHTML;

const matchHtmlRegExp = /["'&<>]/;

/**
 * Escapes special characters and HTML entities in a given html string.
 *
 * @param  {string} string HTML string to escape for later insertion
 * @return {string}
 * @public
 */

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

const long = ("lalala" + "<script>alert(1)</script>" + "lalala").repeat(9000);
const short = "lalala" + "<script>alert(1)</script>" + "lalala";
const middle =
  "lalala".repeat(2000) + "<script>alert(1)</script>" + "lalala".repeat(2000);
const nothing = "lalala".repeat(9999);
group(`long (${long.length})`, () => {
  bench("react's escapeHTML", () => reactEscapeHtml(long));
  bench("bun's escapeHTML", () => bunEscapeHTML(long));
});

group(`short (${short.length})`, () => {
  bench("react's escapeHTML", () => reactEscapeHtml(short));
  bench("bun's escapeHTML", () => bunEscapeHTML(short));
});

group(`middle (${middle.length})`, () => {
  bench("react's escapeHTML", () => reactEscapeHtml(middle));
  bench("bun's escapeHTML", () => bunEscapeHTML(middle));
});

group(`nothing (${nothing.length})`, () => {
  bench("react's escapeHTML", () => reactEscapeHtml(nothing));
  bench("bun's escapeHTML", () => bunEscapeHTML(nothing));
});

await run();
