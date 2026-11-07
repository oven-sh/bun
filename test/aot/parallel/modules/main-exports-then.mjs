// Bun calls the `then` that an entry point exports right behind its last statement, ahead of the jobs that the file has queued.
export function then(resolve) {
  console.log("then is called");
  resolve();
}
queueMicrotask(() => console.log("a microtask"));
console.log("ran");
