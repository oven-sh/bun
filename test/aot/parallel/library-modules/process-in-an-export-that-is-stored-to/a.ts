export let out = process;
export function set(other: typeof process) {
  out = other;
}
export let late: typeof process;
late = process;
