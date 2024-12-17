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
    pid: t.i32.validateInt32().default(0).nonNull,
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
export const UserInfoOptions = t.dictionary({
  encoding: t.DOMString.default(""),
});
export const userInfo = fn({
  args: {
    global: t.globalObject,
    options: UserInfoOptions.default({}),
  },
  ret: t.any,
});
export const version = fn({
  args: {},
  ret: t.DOMString,
});
const PRI_MIN = -20;
const PRI_MAX = 19;
export const setPriority = fn({
  variants: [
    {
      args: {
        global: t.globalObject,
        pid: t.i32.validateInt32(),
        priority: t.i32.validateInt32(PRI_MIN, PRI_MAX),
      },
      ret: t.undefined,
    },
    {
      args: {
        global: t.globalObject,
        priority: t.i32.validateInt32(PRI_MIN, PRI_MAX),
      },
      ret: t.undefined,
    },
  ],
});
