export function inAnArrow() { return (() => ({ [this.eighth()]() {} }))(); }
export function eighth() { return "eighth"; }
