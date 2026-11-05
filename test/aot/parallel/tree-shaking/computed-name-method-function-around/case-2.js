export function getterName() { return { get [this.second()]() { return 2; } }; }
export function second() { return "second"; }
