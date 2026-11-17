import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::tasks::bindings", feature: "Desktop" });

const js = { capability: "js" } as const;
const post = { args: { call: b.any.variadic }, returns: b.undefined, ...js };

export const tasks = b.namespace({
  postBlocking: post,
  post,
  postForHost: post,
  postInBackground: post,
  postDelayed: { args: { delay: b.f64, call: b.any.variadic }, returns: b.f64, ...js },
  cancel: { args: { task: b.f64 }, returns: b.undefined, ...js },
  scrolls: { returns: b.undefined, ...js },
  render: { returns: b.undefined, ...js },
  hurry: { args: { isInput: b.bool.default(true) }, returns: b.undefined, ...js },
  idleTime: { returns: b.f64, ...js },
  setSuspended: { args: { isSuspended: b.bool }, returns: b.undefined, ...js },
  isSuspended: { returns: b.bool, ...js },
  finishCheckpoint: { returns: b.undefined, ...js },
  afterMicrotasks: { args: { run: b.any }, returns: b.undefined, ...js },
  stopRealm: { returns: b.undefined, ...js },
});
