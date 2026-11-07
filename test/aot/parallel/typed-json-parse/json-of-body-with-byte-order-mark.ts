// json() of a Response and of a Request whose text begins with a byte order mark, with a declared type and without.
interface Order {
  id: number;
}
const text = "﻿" + '{"id":1}';
async function attempt(label: string, read: () => Promise<unknown>) {
  try {
    console.log(label, JSON.stringify(await read()));
  } catch (error) {
    console.log(label, "throws", (error as Error).name);
  }
}
await attempt("response, declared", async () => (await new Response(text).json()) as Order);
await attempt("response, unknown ", async () => (await new Response(text).json()) as unknown);
await attempt("request, declared ", async () => (await new Request("http://localhost/", { method: "POST", body: text }).json()) as Order);
await attempt("request, unknown  ", async () => (await new Request("http://localhost/", { method: "POST", body: text }).json()) as unknown);
await attempt("bytes, declared   ", async () => (await new Response(new TextEncoder().encode(text)).json()) as Order);
await attempt("bytes, unknown    ", async () => (await new Response(new TextEncoder().encode(text)).json()) as unknown);
