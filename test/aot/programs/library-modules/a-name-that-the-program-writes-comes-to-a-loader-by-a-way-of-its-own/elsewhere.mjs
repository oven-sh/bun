export const heldElsewhere = process;
export function askElsewhere(name) {
  return process.getBuiltinModule(name);
}
