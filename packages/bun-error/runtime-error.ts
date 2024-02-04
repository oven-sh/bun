// Based on https://github.com/stacktracejs/error-stack-parser/blob/master/error-stack-parser.js

import type { StackFrame as StackFrameType, StackFramePosition, StackFrameScope } from "../../src/api/schema";

export class StackFrame implements StackFrameType {
  function_name: string;
  file: string;
  position: StackFramePosition;
  scope: StackFrameScope;
  lineText: string = "";
  remapped: boolean = false;

  constructor({
    functionName: function_name = "",
    fileName: file = "",
    lineNumber: line = -1,
    columnNumber: column = -1,
    source = "",
  }) {
    this.function_name = function_name;
    this.file = file;
    if (source) this.lineText = source;
    this.scope = 3;
    this.position = {
      line: line,
      source_offset: -1,
      line_start: -1,
      line_stop: -1,
      column_start: column,
      column_stop: -1,
      expression_start: -1,
      expression_stop: -1,
    };
  }
}

const FIREFOX_SAFARI_STACK_REGEXP = /(^|@)\S+:\d+/;
const CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
const SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code])?$/;

export default class RuntimeError {
  original: Error;
  stack: StackFrame[];

  static from(error: Error) {
    const runtime = new RuntimeError();
    runtime.original = error;
    runtime.stack = this.parseStack(error);
    return RuntimeError;
  }

  /**
   * Given an Error object, extract the most information from it.
   *
   * @param {Error} error object
   * @return {Array} of StackFrames
   */
  static parseStack(error) {
    if (error.stack && error.stack.match(CHROME_IE_STACK_REGEXP)) {
      return this.parseV8OrIE(error);
    } else if (error.stack) {
      return this.parseFFOrSafari(error);
    } else {
      return [];
    }
  }

  // Separate line and column numbers from a string of the form: (URI:Line:Column)
  static extractLocation(urlLike) {
    // Fail-fast but return locations like "(native)"
    if (urlLike.indexOf(":") === -1) {
      return [urlLike];
    }

    var regExp = /(.+?)(?::(\d+))?(?::(\d+))?$/;
    var parts = regExp.exec(urlLike.replace(/[()]/g, ""));
    return [parts[1], parts[2] || undefined, parts[3] || undefined];
  }

  static parseV8OrIE(error) {
    var filtered = error.stack.split("\n").filter(function (line) {
      return !!line.match(CHROME_IE_STACK_REGEXP);
    }, this);

    return filtered.map(function (line) {
      if (line.indexOf("(eval ") > -1) {
        // Throw away eval information until we implement stacktrace.js/stackframe#8
        line = line.replace(/eval code/g, "eval").replace(/(\(eval at [^()]*)|(\),.*$)/g, "");
      }
      var sanitizedLine = line.replace(/^\s+/, "").replace(/\(eval code/g, "(");

      // capture and preseve the parenthesized location "(/foo/my bar.js:12:87)" in
      // case it has spaces in it, as the string is split on \s+ later on
      var location = sanitizedLine.match(/ (\((.+):(\d+):(\d+)\)$)/);

      // remove the parenthesized location from the line, if it was matched
      sanitizedLine = location ? sanitizedLine.replace(location[0], "") : sanitizedLine;

      var tokens = sanitizedLine.split(/\s+/).slice(1);
      // if a location was matched, pass it to extractLocation() otherwise pop the last token
      var locationParts = this.extractLocation(location ? location[1] : tokens.pop());
      var functionName = tokens.join(" ") || undefined;
      var fileName = ["eval", "<anonymous>"].indexOf(locationParts[0]) > -1 ? undefined : locationParts[0];

      return new StackFrame({
        functionName: functionName,
        fileName: fileName,
        lineNumber: locationParts[1],
        columnNumber: locationParts[2],
        source: line,
      });
    }, this);
  }

  static parseFFOrSafari(error) {
    var filtered = error.stack.split("\n").filter(function (line) {
      return !line.match(SAFARI_NATIVE_CODE_REGEXP);
    }, this);

    return filtered.map(function (line) {
      // Throw away eval information until we implement stacktrace.js/stackframe#8
      if (line.indexOf(" > eval") > -1) {
        line = line.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g, ":$1");
      }

      if (line.indexOf("@") === -1 && line.indexOf(":") === -1) {
        // Safari eval frames only have function names and nothing else
        return new StackFrame({
          functionName: line,
        });
      } else {
        var functionNameRegex = /((.*".+"[^@]*)?[^@]*)(?:@)/;
        var matches = line.match(functionNameRegex);
        var functionName = matches && matches[1] ? matches[1] : undefined;
        var locationParts = this.extractLocation(line.replace(functionNameRegex, ""));

        return new StackFrame({
          functionName: functionName,
          fileName: locationParts[0],
          lineNumber: locationParts[1],
          columnNumber: locationParts[2],
          source: line,
        });
      }
    }, this);
  }
}
