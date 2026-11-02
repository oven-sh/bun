// The body of a request, a response, a fetch and a blob is read as JSON under a declared type.
type Task = { title: string; points: number; labels: string[] };
function weigh(task: Task): number {
  return task.title.length + task.points + task.labels.length;
}
const text = '{"title":"ab","points":3,"labels":["x"]}';
const readers: Record<string, () => Promise<number>> = {
  async request() {
    return weigh((await new Request("http://localhost/", { method: "POST", body: text }).json()) as Task);
  },
  async response() {
    return weigh((await new Response(text).json()) as Task);
  },
  async fetched() {
    const response = await fetch("data:application/json," + encodeURIComponent(text));
    return weigh((await response.json()) as Task);
  },
  async blob() {
    const task: Task = await new Blob([text]).json();
    return weigh(task);
  },
};
for (const [name, read] of Object.entries(readers)) {
  let total = 0;
  for (let turn = 0; turn < 3; turn++) total += await read();
  console.log(name, total);
}
async function marked(source: Response): Promise<string> {
  try {
    return JSON.stringify((await source.json()) as { title: string; points: number });
  } catch (error) {
    return "rejected " + (error as Error).name;
  }
}
const withMark = '﻿{"title":"ab","points":3}';
console.log(await marked(new Response(withMark)), await marked(new Response(new TextEncoder().encode(withMark))));
