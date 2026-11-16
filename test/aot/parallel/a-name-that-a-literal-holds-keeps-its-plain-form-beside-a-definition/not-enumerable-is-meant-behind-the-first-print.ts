const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  console.log(JSON.stringify(first));
  Object.defineProperty(first, "name", { enumerable: false });
  console.log(JSON.stringify(first));
}
run();
