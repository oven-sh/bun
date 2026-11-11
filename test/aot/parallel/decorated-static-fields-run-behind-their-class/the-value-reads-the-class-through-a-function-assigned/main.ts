function mark(_target: unknown, _key: string) {}
function countNames() { return Registry.names.length; }
function attempt() {
  try { return String(countNames()); } catch (error: any) { return String(error.name); }
}
class Registry {
  static names = ["a", "b"];
  @mark static size = attempt();
}
console.log(Registry.size);
