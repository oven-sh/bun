// For the main realm: what lets a script wait for the event loop while no other script of a page runs.
const waitFor = $bindgen("desktop.bind.ts", "waitFor");
const tasks = require("internal/desktop/tasks");

/** `promise` must not be rejected. */
function block<T>(promise: Promise<T>, pauseRealms: (isPaused: boolean) => void): T {
  let result: T;
  const settled = promise.then(value => void (result = value));
  tasks.setSuspended(true);
  pauseRealms(true);
  try {
    waitFor(settled);
  } finally {
    pauseRealms(false);
    tasks.setSuspended(false);
  }
  return result!;
}

export default { block };
