export interface Frame {
  fn: string;
  file: string | null;
  line: number | null;
  col: number | null;
}

const CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
const SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code])?$/;
const LOCATION_REGEXP = /(.+?)(?::(\d+))?(?::(\d+))?$/;

/**
 * Modern port of the error-stack-parser library
 * https://github.com/stacktracejs/error-stack-parser/blob/9f33c224b5d7b607755eb277f9d51fcdb7287e24/error-stack-parser.js
 */
export function parseStackTrace(error: Error | any): null | Frame[] {
  const stack = error?.stack;
  if (typeof stack === "string") {
    if (stack.match(CHROME_IE_STACK_REGEXP)) {
      return parseV8OrIE(stack);
    }
    return parseFFOrSafari(stack);
  }
  return null;
}

function parseV8OrIE(stack: string): Frame[] {
  return stack
    .split("\n")
    .filter(line => !!line.match(CHROME_IE_STACK_REGEXP) && !line.includes("Bun HMR Runtime"))
    .map(function (line) {
      let sanitizedLine = line
        .replace(/^\s+/, "")
        .replace(/\(eval code/g, "(")
        .replace(/^.*?\s+/, "");

      // capture and preserve the parenthesized location "(/foo/my bar.js:12:87)" in
      // case it has spaces in it, as the string is split on \s+ later on
      let loc = sanitizedLine.match(/ (\(.+\)$)/);

      // remove the parenthesized location from the line, if it was matched
      sanitizedLine = loc ? sanitizedLine.replace(loc[0], "") : sanitizedLine;

      // if a location was matched, pass it to extractLocation() otherwise pass all sanitizedLine
      // because this line doesn't have function name
      let locationParts = extractLocation(loc ? loc[1] : sanitizedLine);
      let functionName = (loc && sanitizedLine) || undefined;
      let fileName = ["eval", "<anonymous>"].indexOf(locationParts[0]) > -1 ? undefined : locationParts[0];

      return {
        fn: functionName,
        file: fileName,
        line: 0 | locationParts[1],
        col: 0 | locationParts[2],
      };
    });
}

function parseFFOrSafari(stack: string): Frame[] {
  // Using string literal "\n" does not work in Safari.
  return stack.split(/\n/g).map((source, i) => {
    let fn = "";
    let file: string | null = null;
    let line: number | null = null;
    let col: number | null = null;
    if (source.endsWith("@")) {
      // Safari eval frames only have function names and nothing else
      fn = source.slice(0, -1);
    } else if (source.indexOf("@") === -1 && source.indexOf(":") === -1) {
      // Safari eval frames only have function names and nothing else
      fn = source.endsWith("@") ? source.slice(0, -1) : source;
    } else {
      var functionNameRegex = /((.*".+"[^@]*)?[^@]*)(?:@)/;
      var matches = source.match(functionNameRegex);
      var functionName = matches && matches[1] ? matches[1] : undefined;
      var locationParts = extractLocation(source.replace(functionNameRegex, ""));
      fn = functionName!;
      file = locationParts[0];
      line = 0 | locationParts[1];
      col = 0 | locationParts[2];
    }
    if (fn === "module code") fn = "";
    return {
      fn,
      file,
      line,
      col,
    };
  });
}

function extractLocation(urlLike: string) {
  // Fail-fast but return locations like "(native)"
  if (urlLike.indexOf(":") === -1) {
    return [urlLike];
  }

  const parts: any = LOCATION_REGEXP.exec(urlLike.replace(/[()]/g, ""));
  return [parts[1], parts[2] || undefined, parts[3] || undefined];
}
