// RUN: lower
// OPTIONS: builtin-modules

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/moved") return Response.redirect("/target", 302);
    if (pathname === "/target") return new Response("arrived");
    if (pathname === "/slow") return new Promise(resolve => setTimeout(() => resolve(new Response("late")), 2000));
    if (pathname === "/form") {
      const form = await request.formData();
      return Response.json({ name: form.get("name"), all: form.getAll("tag"), file: form.get("file")?.size ?? null });
    }
    if (pathname === "/echo") {
      const headers = new Headers({ "x-method": request.method, "x-type": request.headers.get("content-type") ?? "none" });
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      return new Response(await request.arrayBuffer(), { status: 202, statusText: "Taken", headers });
    }
    return new Response(null, { status: 204 });
  },
});
const at = path => new URL(path, server.url).href;

const echoed = await fetch(at("/echo"), { method: "PUT", body: new Uint8Array([104, 105]), headers: [["Content-Type", "application/octet-stream"]] });
console.log(echoed.status, echoed.statusText, echoed.ok, echoed.headers.get("X-Method"), echoed.headers.get("x-type"), echoed.headers.getSetCookie(), new Uint8Array(await echoed.arrayBuffer()));
console.log(echoed.bodyUsed, await echoed.text().catch(error => error.name));
const followed = await fetch(at("/moved"));
console.log(followed.status, followed.redirected, new URL(followed.url).pathname, await followed.text());
const manual = await fetch(at("/moved"), { redirect: "manual" });
console.log(manual.status, manual.headers.get("location"));
const form = new FormData();
form.append("name", "Ada");
form.append("tag", "x");
form.append("tag", "y");
form.append("file", new Blob(["12345"], { type: "text/plain" }), "five.txt");
console.log(await (await fetch(at("/form"), { method: "POST", body: form })).json());
console.log(await (await fetch(at("/form"), { method: "POST", body: new URLSearchParams({ name: "Bob", tag: "z" }) })).json());
const empty = await fetch(at("/nothing"));
console.log(empty.status, JSON.stringify(await empty.text()), [...empty.headers.keys()].includes("content-type"));
const blob = await (await fetch(at("/target"))).blob();
console.log(blob.size, await blob.text());
const controller = new AbortController();
setTimeout(() => controller.abort(), 20);
console.log(await fetch(at("/slow"), { signal: controller.signal }).catch(error => error.name));
console.log(await fetch(at("/slow"), { signal: AbortSignal.timeout(20) }).catch(error => error.name));
console.log(await fetch("http://127.0.0.1:1/").catch(error => error.code ?? error.name));
server.stop(true);

// GENERATED: at
// CHECK-LABEL: function {{*}}name="at"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string|URL flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|URL):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="URL" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(URL) flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="server"
// CHECK-NEXT: v6 = PropGet v5 key="url"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|URL flags=[IsExpected]}
// CHECK-NEXT: v8 = Construct v3, -, v0, v7 calleeName="URL"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|URL flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="href"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
