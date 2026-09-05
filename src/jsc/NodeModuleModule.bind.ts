import { fn, t } from "../codegen/bindgen-lib.ts";

export const _stat = fn({
  args: {
    str: t.UTF8String,
  },
  ret: t.i32,
});
