const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  for (const key in first) console.log(key);
  Object.defineProperty(first, "name", { writable: false });
}
run();
