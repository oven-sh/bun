export function start(options = {}) {
  return new Worker(options.url ?? new URL("./job.mjs", import.meta.url));
}
