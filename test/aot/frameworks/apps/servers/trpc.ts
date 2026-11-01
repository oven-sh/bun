import type { AddressInfo } from "node:net";
import { TRPCClientError, createTRPCClient, httpBatchLink } from "@trpc/client";
import { TRPCError, initTRPC } from "@trpc/server";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { z } from "zod";

const t = initTRPC.context<{ user: string }>().create();
const appRouter = t.router({
  greet: t.procedure
    .input(z.object({ name: z.string().min(2) }))
    .query(({ input, ctx }) => `Hello ${input.name} from ${ctx.user}`),
  add: t.procedure.input(z.tuple([z.number(), z.number()])).mutation(({ input }) => input[0] + input[1]),
  secret: t.procedure.query((): string => {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "no" });
  }),
});
type AppRouter = typeof appRouter;
const server = createHTTPServer({ router: appRouter, createContext: () => ({ user: "server" }) });
await new Promise<void>(resolve => server.listen(0, resolve));
const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `http://localhost:${(server.address() as AddressInfo).port}` })],
});
console.log(await Promise.all([client.greet.query({ name: "Bun" }), client.add.mutate([1, 2])]));
for (const call of [() => client.secret.query(), () => client.greet.query({ name: "x" })])
  try {
    await call();
  } catch (error) {
    console.log(
      error instanceof TRPCClientError,
      (error as TRPCClientError<AppRouter>).data?.code,
      (error as TRPCClientError<AppRouter>).data?.httpStatus,
    );
  }
console.log(await t.createCallerFactory(appRouter)({ user: "caller" }).greet({ name: "direct" }));
server.close();
