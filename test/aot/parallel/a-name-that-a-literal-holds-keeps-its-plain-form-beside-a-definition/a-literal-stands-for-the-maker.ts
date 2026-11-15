const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = { name: "disk", size: 40 };
  const draft: { name?: string; size?: number } = {};
  console.log(JSON.stringify(first));
  Object.defineProperty(first, "name", { writable: false });
}
run();
