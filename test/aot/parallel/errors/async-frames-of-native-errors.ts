// An error that native code rejects with lists the async functions that wait for it, innermost first.
async function inner(path: string) {
  return await Bun.file(path).text();
}
async function middle(path: string) {
  return (await inner(path)).length;
}
async function outer(path: string) {
  return (await middle(path)) + 1;
}
try {
  await outer("/nonexistent/file/for/this/test");
} catch (error) {
  const frames = String((error as Error).stack)
    .split("\n")
    .filter(line => line.includes("at async "));
  const lines = frames.map(line => Number(line.split(":").at(-2)));
  console.log(frames.map(line => line.trim().split(" ")[2]).join(" "), lines[0] < lines[1] && lines[1] < lines[2]);
}
