import { t, fn } from "bindgen";

export const clone = fn({
  this: t.externalClass("Request"),
  args: {
    global: t.globalObject,
    this_js: t.anyThisValue,
  },
  ret: t.externalClass("Request"),
});
