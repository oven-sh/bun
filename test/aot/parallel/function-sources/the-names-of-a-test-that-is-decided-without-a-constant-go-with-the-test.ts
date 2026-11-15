// Flags: --aot-check=Validate
// Neither test folds to a constant, and each is decided: the text keeps the branch that stays, as plain Bun's does.
function one(value: unknown): string { return "one:" + String(value); }
function two(): string { return "two"; }
function pick(given?: string): string { return given !== undefined || true ? one(given) : two(); }
function warn(held: boolean): string { const warning = held && false ? "text" : null; const next = String(held); return warning ?? next; }
function both(held: boolean, given?: string): string { return (held && given !== undefined) || !false ? one(given) : two(); }
console.log(pick("a"), warn(true), both(false, "b"));
console.log(String(pick).includes("two"), String(warn).includes("text"), String(both).includes("two"));
