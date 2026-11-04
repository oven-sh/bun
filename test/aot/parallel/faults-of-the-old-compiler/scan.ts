interface Control { stop: () => void }
class Stats { parts = 0; }
function scan(url: string, limit: number): string {
  let stopped = false;
  const ctl: Control = { stop: () => { stopped = true; } };
  new Stats();
  const parts = url.split("/");
  let size = 0;
  for (const p of parts) size += p.length;
  if (size > limit) ctl.stop();
  return (stopped ? "stopped" : "done");
}
const url: string = process.argv[2] ?? "a/bcdefgh";
function run(): void { console.log(scan(url, 3), scan(url + "/ij", 5), scan(url, 300)); }
function help(): void { console.log("help"); }
const commands = { run, help };
const conf: { plugin?: string } = JSON.parse(process.argv[4] ?? "{}");
if (conf.plugin) (await import(conf.plugin)).register(commands);
commands[(process.argv[3] ?? "run") as keyof typeof commands]();
export {};
