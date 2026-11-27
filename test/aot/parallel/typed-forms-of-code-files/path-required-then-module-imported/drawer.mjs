globalThis.opened = (globalThis.opened ?? 0) + 1;
export const handles = 2;
export default "oak";
export function pull() {
  return handles * 10 + globalThis.opened;
}
