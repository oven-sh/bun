const pair = (name: string, size: number) => ({ name, size });
function run() {
  const first = pair("disk", 40);
  const second = pair("tape", 7);
  console.log(JSON.stringify(first), second.name, first.size + second.size);
}
run();
