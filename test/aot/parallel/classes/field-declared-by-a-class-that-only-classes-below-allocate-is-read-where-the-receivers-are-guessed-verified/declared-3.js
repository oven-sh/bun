import { note } from "./declared-2.js";
export function tell(label, value) {
  note("runs", label);
  return value;
}
export function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
export async function wait(label, run) {
  try {
    note(label, "=", await run());
  } catch (error) {
    note(label, "REJECTS", error.constructor.name);
  }
}
