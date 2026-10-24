export function log(...values: unknown[]) {
  console.log(...values.map(value => (typeof value === "function" ? "function " + value.name : value)));
}
export function attempt(run: () => unknown) {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
