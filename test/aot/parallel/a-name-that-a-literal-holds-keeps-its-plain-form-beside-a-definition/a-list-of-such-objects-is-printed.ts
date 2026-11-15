const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  console.log(JSON.stringify([first, pair("tape", 7)]));
  Object.defineProperty(first, "name", { writable: false });
}
run();
