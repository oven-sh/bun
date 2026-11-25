const pair = (name: string, size: number) => ({ name, size });
function other() { const draft: { name?: string; size?: number } = {}; return draft; }
function run() {
  const first = pair("disk", 40);
  other();
  console.log(JSON.stringify(first));
  Object.defineProperty(first, "name", { writable: false });
}
run();
