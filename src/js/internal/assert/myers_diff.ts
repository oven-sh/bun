"use strict";

const colors = require("internal/util/colors");

const enum Operation {
  Insert = 0,
  Delete = 1,
  Equal = 2,
}
interface Diff {
  operation: Operation;
  text: string;
}

declare namespace Internal {
  export function myersDiff(actual: string[], expected: string[], checkCommaDisparity?: boolean): Diff[];
}

const kNopLinesToCollapse = 5;

const { myersDiff } = $zig("node_assert_binding.zig", "generate") as typeof Internal;

function printSimpleMyersDiff(diff: Diff[]) {
  let message = "";

  for (let diffIdx = diff.length - 1; diffIdx >= 0; diffIdx--) {
    const { operation: type, text: value } = diff[diffIdx];
    switch (type) {
      case Operation.Insert:
        message += `${colors.green}${value}${colors.white}`;
        break;
      case Operation.Delete:
        message += `${colors.red}${value}${colors.white}`;
        break;
      case Operation.Equal:
        message += `${colors.white}${value}${colors.white}`;
        break;
      default:
        throw new TypeError(`Invalid diff operation kind: ${type}`); // should be unreachable
    }
  }

  return `\n${message}`;
}

function printMyersDiff(diff: Diff[], simple = false) {
  let message = "";
  let skipped = false;
  let nopCount = 0;

  for (let diffIdx = diff.length - 1; diffIdx >= 0; diffIdx--) {
    const { operation: type, text: value } = diff[diffIdx];
    const previousType = diffIdx < diff.length - 1 ? diff[diffIdx + 1].operation : null;
    const typeChanged = previousType && type !== previousType;

    if (typeChanged && previousType === Operation.Equal) {
      // Avoid grouping if only one line would have been grouped otherwise
      if (nopCount === kNopLinesToCollapse + 1) {
        message += `${colors.white}  ${diff[diffIdx + 1].operation}\n`;
      } else if (nopCount === kNopLinesToCollapse + 2) {
        message += `${colors.white}  ${diff[diffIdx + 2].operation}\n`;
        message += `${colors.white}  ${diff[diffIdx + 1].operation}\n`;
      }
      if (nopCount >= kNopLinesToCollapse + 3) {
        message += `${colors.blue}...${colors.white}\n`;
        message += `${colors.white}  ${diff[diffIdx + 1].operation}\n`;
        skipped = true;
      }
      nopCount = 0;
    }

    switch (type) {
      case Operation.Insert:
        message += `${colors.green}+${colors.white} ${value}\n`;
        break;
      case Operation.Delete:
        message += `${colors.red}-${colors.white} ${value}\n`;
        break;
      case Operation.Equal:
        if (nopCount < kNopLinesToCollapse) {
          message += `${colors.white}  ${value}\n`;
        }
        nopCount++;
        break;
      default:
        throw new TypeError(`Invalid diff operation kind: ${type}`); // should be unreachable
    }
  }

  message = message.trimEnd();

  return { message: `\n${message}`, skipped };
}

export default { myersDiff, printMyersDiff, printSimpleMyersDiff };
