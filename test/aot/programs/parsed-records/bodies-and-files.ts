const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Task { id: number; title: string; done: boolean }
function line(task: Task): string {
  return `${task.id} ${task.title} ${task.done ? "x" : " "}`;
}
leak({ id: 0, title: "", done: false } satisfies Task);
console.log(line({ id: 1, title: "a", done: true }));
const text = '{"id":7,"title":"Zoë ✓","done":false}';
const list = `[${text},${text},{"id":8,"title":"b","done":true,"extra":null}]`;
for (let round = 0; round < 3; round++) {
  console.log(line(await new Response(text).json()), line(await new Request("http://localhost/", { method: "POST", body: text }).json()), line(await new Blob([text]).json()));
  console.log(((await new Response(list).json()) as Task[]).map(line).join("|"));
  console.log(line(await new Response(new TextEncoder().encode(text)).json()), JSON.stringify(await Response.json(parse(text)).json()));
  console.log(line(parse(Buffer.from(text).toString())), line(parse(new String(text) as string)), line(parse({ toString: () => text } as any)));
}
for (const bad of ['{"id":7,"title":"a","done":', '{"id":7,,"title":"a"}', '{"id":7 "title":"a"}', "{'id':7}", '{"id":07,"title":"a","done":true}', '{"id":7,"title":"a","done":true}}', '{"id":7,"title":"a\n","done":true}']) {
  try {
    console.log(parse(bad));
  } catch (error) {
    console.log((error as Error).name, (error as Error).message);
  }
  try {
    console.log(await new Response(bad).json());
  } catch (error) {
    console.log((error as Error).name);
  }
}
export {};
