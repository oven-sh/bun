// import
import "./outside/adds-from-the-head";
/** What a module requires of a global. */
export function f(module: number, global: number) {
  return module + global;
}
export { f as g };
