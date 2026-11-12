const pair = (name: string, size: number) => ({ name, size });
interface Draft { name?: string; size?: number }
function run() {
  const first = pair("disk", 40);
  const draft: Draft = {};
  console.log(JSON.stringify(first));
  Object.defineProperty(first, "name", { writable: false });
}
run();
