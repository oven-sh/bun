import { applyReplacements, function_replacements } from "./replacements";

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createStopRegex(allow_comma: boolean) {
  return new RegExp(
    "['\"}`\\)\\/" +
      (allow_comma ? "," : "") +
      "]|(?<!\\$)\\brequire\\(|(" +
      function_replacements.map(x => escapeRegex(x) + "\\(").join("|") +
      ")",
  );
}

const stop_regex_comma = createStopRegex(true);
const stop_regex_no_comma = createStopRegex(false);

// A `/` divides after a token that can end an expression. After `)` or `}` only a parser can tell, so those divide too.
const regex_can_follow =
  /(?:^|[([{,;:?=&|^~*%<>]|\.\.\.|(?<![\w$)\]])!|(?<!\+)\+|(?<!-)-|(?<![.#\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|default|await|yield))$/;

/**
 * Slices a string until it hits a }, but keeping in mind JS comments,
 * regex, template literals, comments, and matching {
 *
 * Used to extract function bodies without parsing the code.
 *
 * If you pass replace=true, it will run replacements on the code
 */
export function sliceSourceCode(
  contents: string,
  replace: boolean,
  replaceRequire?: (specifier: string) => string,
  endOnComma = false,
): { result: string; rest: string } {
  let bracketCount = 0;
  let i = 0;
  let result = "";
  // The end of the source consumed so far, comments and trailing whitespace left out. It decides what a `/` is.
  let before = "";
  while (contents.length) {
    const match = contents.match(endOnComma && bracketCount <= 1 ? stop_regex_comma : stop_regex_no_comma);
    i = match?.index ?? contents.length;
    if (match?.[1]) {
      i += match[1].length - 1;
    }
    const code = contents.slice(0, i);
    bracketCount += [...code.matchAll(/[({]/g)].length;
    const chunk = replace ? applyReplacements(contents, i) : [code, contents.slice(i)];
    result += chunk[0];
    contents = chunk[1] as string;
    if (chunk[2]) {
      before = ")";
      continue;
    }
    if (!contents.length) break;
    if (contents.startsWith("/")) {
      // A comment keeps `before` and a lone `/` reads it. Every other stop replaces it.
      before = (before + code).trimEnd().slice(-16);
    }
    if (contents.startsWith("/*")) {
      i = contents.indexOf("*/", 2) + 2;
      if (i === 1) throw new Error("Comment did not end");
    } else if (contents.startsWith("//")) {
      i = contents.indexOf("\n", 2);
      if (i === -1) i = contents.length;
    } else if (contents.startsWith("/")) {
      if (regex_can_follow.test(before)) {
        const { result: result2, rest } = sliceRegularExpressionSourceCode(contents.slice(1), replace);
        result += "/" + result2;
        contents = rest;
        before = "/";
        continue;
      }
      i = 1;
    } else if (contents.startsWith("'")) {
      i = getEndOfBasicString(contents.slice(1), "'") + 2;
    } else if (contents.startsWith('"')) {
      i = getEndOfBasicString(contents.slice(1), '"') + 2;
    } else if (contents.startsWith("`")) {
      const { result: result2, rest } = sliceTemplateLiteralSourceCode(contents.slice(1), replace);
      result += "`" + result2;
      contents = rest;
      before = "`";
      i = 0;
      continue;
    } else if (contents.startsWith("}")) {
      bracketCount--;
      if (bracketCount <= 0) {
        result += "}";
        contents = contents.slice(1);
        break;
      }
      i = 1;
    } else if (contents.startsWith(")")) {
      bracketCount--;
      if (bracketCount <= 0) {
        result += ")";
        contents = contents.slice(1);
        break;
      }
      i = 1;
    } else if (endOnComma && contents.startsWith(",")) {
      if (bracketCount <= 1) {
        contents = contents.slice(1);
        // if the next non-whitespace character is ), we will treat it like a )
        let match = contents.match(/^\s*\)/);
        if (match) {
          contents = contents.slice(match[0].length);
          result += ")";
        } else {
          result += ",";
        }
        break;
      }
      i = 1;
    } else if (contents.startsWith("require(")) {
      if (replaceRequire) {
        const staticSpecifier = contents.match(/\brequire\(["']([^"']+)["']\)/);
        if (staticSpecifier) {
          const specifier = staticSpecifier[1];
          result += replaceRequire(specifier);
          contents = contents.slice(staticSpecifier[0].length);
          before = ")";
          continue;
        } else {
          throw new Error("Require with dynamic specifier not supported here.");
        }
      } else {
        throw new Error("Require is not supported here.");
      }
    } else {
      console.error(contents.slice(0, 100));
      throw new Error("TODO");
    }
    if (!contents.startsWith("/*") && !contents.startsWith("//")) {
      before = contents[i - 1];
    }
    result += contents.slice(0, i);
    contents = contents.slice(i);
  }

  return { result, rest: contents };
}

function sliceTemplateLiteralSourceCode(contents: string, replace: boolean) {
  let i = 0;
  let result = "";
  while (contents.length) {
    i = contents.match(/\\|`|\${/)!.index!;
    result += contents.slice(0, i);
    contents = contents.slice(i);
    if (!contents.length) break;
    if (contents.startsWith("\\")) {
      result += contents.slice(0, 2);
      contents = contents.slice(2);
      continue;
    } else if (contents.startsWith("`")) {
      result += "`";
      contents = contents.slice(1);
      break;
    } else if (contents.startsWith("$")) {
      const { result: result2, rest } = sliceSourceCode(contents.slice(1), replace);
      result += "$" + result2;
      contents = rest;
      continue;
    } else {
      throw new Error("TODO");
    }
  }

  return { result, rest: contents };
}

function sliceRegularExpressionSourceCode(contents: string, replace: boolean) {
  let i = 0;
  let result = "";
  while (contents.length) {
    i = contents.match(/\/(?!\/|\*)|\\|\[/)!.index!;
    result += contents.slice(0, i);
    contents = contents.slice(i);
    if (!contents.length) break;
    if (contents.startsWith("/")) {
      result += "/";
      contents = contents.slice(1);
      break;
    } else if (contents.startsWith("\\")) {
      result += "\\";
      contents = contents.slice(1);
      if (!contents.length) break;
      result += contents[0];
      contents = contents.slice(1);
      continue;
    } else if (contents.startsWith("[")) {
      // An escape is a pair, so the `]` in `[/\\]` closes the class.
      const end = contents.match(/^\[(?:\\[^]|[^\]\\])*\]/)![0].length;
      result += contents.slice(0, end);
      contents = contents.slice(end);
      continue;
    } else {
      throw new Error("TODO");
    }
  }

  return { result, rest: contents };
}

function getEndOfBasicString(str: string, quote: "'" | '"') {
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\\") {
      i++;
    } else if (str[i] === quote) {
      return i;
    }
    i++;
  }
  throw new Error("String did not end");
}
