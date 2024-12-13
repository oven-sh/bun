// Internal bindings for node:os
// The entrypoint for node:os is `src/js/node/os.ts`
import { fn, t } from "bindgen";

export const cpus = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.any,
});
export const freemem = fn({
  args: {},
  ret: t.u64,
});
export const getPriority = fn({
  args: {
    global: t.globalObject,
    pid: t.i32.validateInt32(),
  },
  ret: t.i32,
});
export const homedir = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.DOMString,
});
export const hostname = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.any,
});
export const loadavg = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.any,
});
export const networkInterfaces = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.any,
});
export const release = fn({
  args: {},
  ret: t.DOMString,
});
export const totalmem = fn({
  args: {},
  ret: t.u64,
});
export const uptime = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.f64,
});
export const userInfo = fn({
  args: {
    global: t.globalObject,
  },
  ret: t.any,
});
export const version = fn({
  args: {},
  ret: t.DOMString,
});
