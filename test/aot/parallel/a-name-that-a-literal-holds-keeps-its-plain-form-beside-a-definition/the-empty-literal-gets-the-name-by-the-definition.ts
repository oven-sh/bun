const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const draft: { name?: string; size?: number } = {};
  Object.defineProperty(draft, "name", { value: "laid" });
  console.log(JSON.stringify(first), JSON.stringify(draft), draft.name);
}
run();
