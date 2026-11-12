const pair = (name: string, size: number) => ({ name, size });
function lock(o: { name: string; size: number }) { Object.defineProperty(o, "name", { writable: false }); }
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  console.log(JSON.stringify(first));
  lock(first);
}
run();
