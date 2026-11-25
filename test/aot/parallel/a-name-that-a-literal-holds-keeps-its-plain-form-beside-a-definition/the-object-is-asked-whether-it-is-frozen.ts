const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  Object.preventExtensions(first); console.log(Object.isFrozen(first), Object.isSealed(first));
  if (process.argv.length > 90) Object.defineProperty(first, "name", { writable: false, enumerable: true });
}
run();
