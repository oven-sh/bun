import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::event_loop" });

export const ActiveTasks = b.dictionary({
  enteredCount: b.i32,
  activeTasks: b.usize,
  tasks: b.usize,
  immediateTasks: b.usize,
  concurrentTasksEmpty: b.bool,
  loopActive: b.bool,
  eventLoopAlive: b.bool,
  concurrentRef: b.i32,
  numPolls: b.i32,
  iteration: b.u64,
});

export const getActiveTasks = b.fn({ returns: ActiveTasks, capability: "heap" });

export const runNestedUntilSettled = b.fn({ args: { promise: b.any }, capability: "js", throws: true });
