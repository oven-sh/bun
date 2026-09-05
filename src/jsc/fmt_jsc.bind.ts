import { fn, t } from "../codegen/bindgen-lib.ts";

export const Formatter = t.stringEnum("highlight-javascript", "highlight-javascript-redacted", "escape-powershell");

export const fmtString = fn({
  args: {
    global: t.globalObject,
    code: t.UTF8String,
    formatter: Formatter,
  },
  ret: t.DOMString,
});
