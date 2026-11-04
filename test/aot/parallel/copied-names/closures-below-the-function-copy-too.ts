function outer(): string { const held = "h"; const made = make(); return made() + made(); function make(): () => string { return () => held; } }
console.log(outer());
