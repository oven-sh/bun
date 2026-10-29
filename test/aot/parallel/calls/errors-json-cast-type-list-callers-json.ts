// json() rejects when the body was read before. The cast to a type changes neither the error nor the callers in its stack.
type Order = { id: number; name: string };

function namesIn(error: Error) {
  const names = String(error.stack)
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""))
    .filter(name => name !== "json")
    .slice(0, 2);
  return names.map(name => (/[\\/:]/.test(name) ? "<file>" : name)).join(" < ");
}

async function readOrder(body: Response | Request | Blob) {
  return (await body.json()) as Order;
}

async function readTwice(name: string, body: Response | Request) {
  console.log(name, (await readOrder(body)).id);
  try {
    console.log(name, (await readOrder(body)).id);
  } catch (error) {
    console.log(name, (error as Error).name, (error as Error).message, "|", namesIn(error as Error));
  }
}

const text = JSON.stringify({ id: 7, name: "seven" });
for (let turn = 0; turn < 3; turn++) {
  await readTwice("response", new Response(text));
  await readTwice("request", new Request("http://example.com/", { method: "POST", body: text }));
  console.log("blob", (await readOrder(new Blob([text]))).name);
}
