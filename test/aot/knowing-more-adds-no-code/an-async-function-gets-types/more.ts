
type Job = { id: number; payload: string; retries: number };
async function run(job: Job): Promise<string> {
  let text = "";
  for (let i = 0; i <= job.retries; i++) {
    await null;
    text += job.id + ":" + job.payload + ":" + i + ";";
  }
  return text;
}
const table: Record<string, (job: any) => Promise<string>> = { run };
const job = JSON.parse(process.argv[2] ?? '{"id":7,"payload":"p","retries":2}');
console.log(await table[process.argv[3] ?? "run"](job));
