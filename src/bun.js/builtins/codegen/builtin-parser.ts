import { applyReplacements } from "./replacements";

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
): { result: string; rest: string; usesThis: boolean } {
  let bracketCount = 0;
  let i = 0;
  let result = "";
  let usesThis = false;
  while (contents.length) {
    // TODO: template literal, regexp
    // these are important because our replacement logic would replace intrinsics
    // within these, when it should remain as the literal dollar.
    // but this isn't used in the codebase
    i = contents.match(/\/\*|\/\/|'|"|{|}|`/)?.index ?? contents.length;
    const chunk = replace ? applyReplacements(contents.slice(0, i)) : contents.slice(0, i);
    if (chunk.includes("this")) usesThis = true;
    result += chunk;
    contents = contents.slice(i);
    if (!contents.length) break;
    if (contents.startsWith("/*")) {
      i = contents.slice(2).indexOf("*/") + 2;
    } else if (contents.startsWith("//")) {
      i = contents.slice(2).indexOf("\n") + 2;
    } else if (contents.startsWith("'")) {
      i = contents.slice(1).match(/(?<!\\)'/)!.index! + 2;
    } else if (contents.startsWith('"')) {
      i = contents.slice(1).match(/(?<!\\)"/)!.index! + 2;
    } else if (contents.startsWith("`")) {
      const { result: result2, rest } = sliceTemplateLiteralSourceCode(contents.slice(1), replace);
      result += "`" + result2;
      contents = rest;
      continue;
    } else if (contents.startsWith("{")) {
      bracketCount++;
      i = 1;
    } else if (contents.startsWith("}")) {
      bracketCount--;
      if (bracketCount <= 0) {
        result += "}";
        contents = contents.slice(1);
        break;
      }
      i = 1;
    } else {
      throw new Error("TODO");
    }
    result += contents.slice(0, i);
    contents = contents.slice(i);
  }

  return { result, rest: contents, usesThis };
}

function sliceTemplateLiteralSourceCode(contents: string, replace: boolean) {
  let i = 0;
  let result = "";
  let usesThis = false;
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
      const { result: result2, rest, usesThis: usesThisVal } = sliceSourceCode(contents.slice(1), replace);
      result += "$" + result2;
      contents = rest;
      usesThis ||= usesThisVal;
      continue;
    } else {
      throw new Error("TODO");
    }
  }

  return { result, rest: contents, usesThis };
}
