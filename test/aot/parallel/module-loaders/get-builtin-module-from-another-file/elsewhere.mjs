export const held = process;
export const load = process.getBuiltinModule;
export function ask(name) { return process.getBuiltinModule(name); }
