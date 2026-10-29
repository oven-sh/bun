export function load() {
  if (Math.random() > 2) {
    return import("./outside/adds-a-global");
  }
}
