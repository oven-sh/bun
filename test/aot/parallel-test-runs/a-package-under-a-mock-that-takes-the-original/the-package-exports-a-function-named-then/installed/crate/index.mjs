export const label = "real label";
export function then(settle) {
  globalThis.callsOfThen = (globalThis.callsOfThen ?? 0) + 1;
  settle({ label: "label from then" });
}
