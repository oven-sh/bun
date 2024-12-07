import { fn, t } from "bindgen";

const implNamespace = "js_bindings";

export const Formatter = t.stringEnum("highlightJavascript", "escapePowershell");

fn({
  name: "fmtString",
  implNamespace,
  args: {
    global: t.globalObject,
    code: t.DOMString,
    formatter: t.i32,
  },
  ret: t.DOMString,
});
