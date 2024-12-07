import { fn, t } from "bindgen";

const implNamespace = "js_bindings";

export const Formatter = t.stringEnum("highlight-javascript", "escape-powershell");

fn({
  name: "fmtString",
  implNamespace,
  args: {
    global: t.globalObject,
    code: t.UTF8String,
    formatter: Formatter,
  },
  ret: t.DOMString,
});
