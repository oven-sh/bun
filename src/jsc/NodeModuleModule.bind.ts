import { fn, t } from "bindgen";

export const _stat = fn({
  args: {
    str: t.UTF8String,
  },
  ret: t.i32,
});
