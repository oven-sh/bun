export function server(host, port) { return { host, port }; }
export function lock(o) { Object.defineProperty(o, "host", { writable: false }); }
