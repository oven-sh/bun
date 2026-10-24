export class Handle { close() {} }
export function startTimer(f, ms) { return ms; }
export function stopTimer(timer) {}
export function open(name) { return name === "real" ? new Handle() : name; }
