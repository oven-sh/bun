export function lock(o) { Object.defineProperty(o, "host", { writable: false }); }
