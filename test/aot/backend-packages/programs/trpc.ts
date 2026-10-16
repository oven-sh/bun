import { initTRPC, TRPCError } from "@trpc/server";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import type { AddressInfo } from "node:net";

const t = initTRPC.context<{ user: string }>().create();
const number = (value: unknown): number => { if (typeof value !== "number") throw new Error("not a number"); return value; };
const appRouter = t.router({
  double: t.procedure.input(number).query(({ input }) => input * 2),
  whoami: t.procedure.query(({ ctx }) => ctx.user),
  people: t.router({ add: t.procedure.input((value: unknown) => value as { name: string }).mutation(({ input }) => ({ id: 1, name: input.name.toUpperCase() })) }),
  secret: t.procedure.query(() => { throw new TRPCError({ code: "FORBIDDEN", message: "no" }); }),
});
const caller = t.createCallerFactory(appRouter)({ user: "direct" });
console.log(await caller.double(21), await caller.whoami(), JSON.stringify(await caller.people.add({ name: "ada" })));
try { await caller.secret(); } catch (error) { console.log((error as TRPCError).code); }

const server = createHTTPServer({ router: appRouter, createContext: () => ({ user: "http" }) });
const port = await new Promise<number>(resolve => { const listening = server.listen(0, "127.0.0.1"); listening.on("listening", () => resolve((listening.address() as AddressInfo).port)); });
const base = `http://127.0.0.1:${port}`;
console.log(await (await fetch(base + "/double?input=" + encodeURIComponent("4"))).text());
console.log(await (await fetch(base + "/people.add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "grace" }) })).text());
const refused = await fetch(base + "/double?input=" + encodeURIComponent('"x"'));
console.log(refused.status, ((await refused.json()) as { error: { message: string; data: { code: string } } }).error.data.code);
server.close();
console.log("DONE");
process.exit(0);
