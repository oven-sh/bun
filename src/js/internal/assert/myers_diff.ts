/// <reference path="../../builtins.d.ts" />
"use strict";

const colors = require("internal/util/colors");

const enum Operation {
  Insert = 0,
  Delete = 1,
  Equal = 2,
}
interface Diff {
  kind: Operation;
  /**
   * When diffing chars (that is, `line == false`, this is a char code.)
   */
  value: string | number;
}

declare namespace Internal {
  export function myersDiff(actual: string, expected: string, checkCommaDisparity?: boolean, lines?: boolean): Diff[];
  /** Diffs by char and renders the `printSimpleMyersDiff` string. */
  export function printSimpleMyersDiff(actual: string, expected: string, colors: object): string;
  /** Diffs by line and renders the `printMyersDiff` message, collapsing long unchanged runs. */
  export function printMyersDiff(
    actual: string,
    expected: string,
    checkCommaDisparity: boolean,
    colors: object,
  ): { message: string; skipped: boolean };
}

const native = $rust("node_assert_binding.rs", "generate") as typeof Internal;

function printSimpleMyersDiff(actual: string, expected: string) {
  return native.printSimpleMyersDiff(actual, expected, colors);
}

function printMyersDiff(actual: string, expected: string, checkCommaDisparity: boolean) {
  return native.printMyersDiff(actual, expected, checkCommaDisparity, colors);
}

export default { myersDiff: native.myersDiff, printMyersDiff, printSimpleMyersDiff };
