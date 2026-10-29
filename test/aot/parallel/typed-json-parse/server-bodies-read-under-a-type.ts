// A handler of a route and the handler of every request read their bodies as JSON under a declared type.
type Task = { title: string; points: number; labels: string[] };
function weigh(task: Task): number {
  return task.title.length + task.points + task.labels.length;
}
const text = '{"title":"ab","points":3,"labels":["x"]}';
const server = Bun.serve({
  port: 0,
  routes: {
    "/projects/:id/tasks": {
      POST: async request => {
        const task = (await request.json()) as Task;
        return new Response(request.params.id + ":" + weigh(task));
      },
    },
  },
  async fetch(request) {
    return new Response(String(weigh((await request.json()) as Task)));
  },
});
for (const path of ["/projects/7/tasks", "/"]) {
  const answer = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", body: text });
  console.log(await answer.text());
}
server.stop(true);
