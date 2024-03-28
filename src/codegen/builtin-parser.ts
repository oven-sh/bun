import { applyReplacements, function_replacements } from "./replacements";

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createStopRegex(allow_comma: boolean) {
  return new RegExp(
    "((?:[(,=;:{]|return|\\=\\>)\\s*)\\/[^\\/\\*]|\\/\\*|\\/\\/|['\"}`\\)" +
      (allow_comma ? "," : "") +
      "]|(?<!\\$)\\brequire\\(|(" +
      function_replacements.map(x => escapeRegex(x) + "\\(").join("|") +
      ")",
  );
}

const stop_regex_comma = createStopRegex(true);
const stop_regex_no_comma = createStopRegex(false);

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
  while (contents.length) {
    const match = contents.match(endOnComma && bracketCount <= 1 ? stop_regex_comma : stop_regex_no_comma);
    i = match?.index ?? contents.length;
    if (match?.[2]) {
      i += match[2].length - 1;
    }
    bracketCount += [...contents.slice(0, i).matchAll(/[({]/g)].length;
    const chunk = replace ? applyReplacements(contents, i) : [contents.slice(0, i), contents.slice(i)];
    result += chunk[0];
    contents = chunk[1] as string;
    if (chunk[2]) {
      continue;
    }
    if (match?.[1]) {
      if (match[1].startsWith("(") || match[1].startsWith(",")) {
        bracketCount++;
      }
      const { result: result2, rest } = sliceRegularExpressionSourceCode(
        contents.slice(match?.[1].length + 1),
        replace,
      );
      result += contents.slice(0, match?.[1].length + 1) + result2;
      contents = rest;
      continue;
    }
    if (!contents.length) break;
    if (contents.startsWith("/*")) {
      i = contents.slice(2).indexOf("*/") + 2;
    } else if (contents.startsWith("//")) {
      i = contents.slice(2).indexOf("\n") + 2;
    } else if (contents.startsWith("'")) {
      i = getEndOfBasicString(contents.slice(1), "'") + 2;
    } else if (contents.startsWith('"')) {
      i = getEndOfBasicString(contents.slice(1), '"') + 2;
    } else if (contents.startsWith("`")) {
      const { result: result2, rest } = sliceTemplateLiteralSourceCode(contents.slice(1), replace);
      result += "`" + result2;
      contents = rest;
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
    result += contents.slice(0, i);
    contents = contents.slice(i);
  }

  return { result, rest: contents };
}

function sliceTemplateLiteralSourceCode(contents: string, replace: boolean) {
  let i = 0;
  let result = "";
  while (contents.length) {
    i = contents.match(/`|\${/)!.index!;
    result += contents.slice(0, i);
    contents = contents.slice(i);
    if (!contents.length) break;
    if (contents.startsWith("`")) {
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
      let end = contents.match(/(?<!\\)]/)!.index!;
      result += contents.slice(0, end + 1);
      contents = contents.slice(end + 1);
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
