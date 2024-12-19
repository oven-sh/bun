import { Fn, t } from "bindgen";

const implNamespace = "js_bindings";

export const Formatter = t.stringEnum("highlight-javascript", "escape-powershell");

export const fmtString = Fn({
  implNamespace,
  args: {
    global: t.globalObject,
    code: t.UTF8String,
    formatter: Formatter,
  },
  ret: t.BunString,
});
