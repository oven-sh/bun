export function readsThis() { return this; }
export function quiet() { return 0; }
export default function () { return this; }
export const kept = { receiver: undefined };
export function storesThis() { kept.receiver = this; return 0; }
