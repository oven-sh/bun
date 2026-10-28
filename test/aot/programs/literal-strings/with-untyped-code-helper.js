export function read(o) { return o.mode + "," + o.name + "," + o.fallback; }
export function write(o, mode) { o.mode = mode; }
export function make(mode) { return { mode, name: "made" }; }
export function echo(x) { return x; }
export function keys(o) { return Object.keys(o).join(); }
