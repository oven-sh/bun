// Internal bindings for node:os
// The entrypoint for node:os is `src/js/node/os.ts`
import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::os::js_bindings" });

export const hostCpuCount = b.fn({ returns: b.i32 });
export const cpus = b.fn({ returns: b.any, capability: "js", throws: true });
export const freemem = b.fn({ returns: b.u64 });
export const getPriority = b.fn({
  args: {
    pid: b.i32.validateInteger().default(0),
  },
  returns: b.i32,
  capability: "js",
  throws: true,
  length: 1,
});
export const homedir = b.fn({ returns: b.string, capability: "js", throws: true });
export const hostname = b.fn({ returns: b.any, capability: "js", throws: true });
export const loadavg = b.fn({ returns: b.array(b.f64) });
export const networkInterfaces = b.fn({ returns: b.any, capability: "js", throws: true });
export const release = b.fn({ returns: b.string });
export const totalmem = b.fn({ returns: b.u64 });
export const uptime = b.fn({ returns: b.f64, capability: "js", throws: true });

export const UserInfoOptions = b.dictionary("UserInfoOptions", {
  encoding: b.string.loose.default(""),
});
export const userInfo = b.fn({
  args: {
    options: UserInfoOptions.nullable.default({}),
  },
  returns: b.any,
  capability: "js",
  throws: true,
  length: 1,
});
export const version = b.fn({ returns: b.string, throws: true });

const PRI_MIN = -20;
const PRI_MAX = 19;
export const setPriority = b.overloads(
  {
    args: {
      pid: b.i32.validateInteger(),
      priority: b.i32.validateInteger(PRI_MIN, PRI_MAX),
    },
    capability: "js",
    throws: true,
    rustPath: "crate::node::os::js_bindings::set_priority",
    length: 2,
  },
  {
    args: {
      priority: b.i32.validateInteger(PRI_MIN, PRI_MAX),
    },
    capability: "js",
    throws: true,
    rustPath: "crate::node::os::js_bindings::set_priority_of_current_process",
  },
);
