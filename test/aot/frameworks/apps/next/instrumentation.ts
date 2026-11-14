export function register() {
  (globalThis as { registeredBy?: string }).registeredBy = "instrumentation in " + process.env.NEXT_RUNTIME;
}
