import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

async function handle({ getRouter, request, executeRouter, context, executed, signal, event }) {
  const router = await getRouter();
  if (signal.aborted || executed || !event) throw new Error("stopped");
  return executeRouter(context, router, request);
}

async function resolveRequest(request, options, event) {
  const signal = { aborted: false };
  let routerPromise;
  let executed;
  const getRouter = () => {
    routerPromise ??= (async () => {
      if (signal.aborted) throw new Error("aborted");
      return { request, options, event };
    })();
    return routerPromise;
  };
  const start = { getRouter, request, executed };
  const executeRouter = async (context, matched, instance) => {
    if (signal.aborted) throw new Error("aborted");
    return request.id + (options.extra ?? 0) + matched.request.id + instance.id + context.weight;
  };
  const terminal = ({ context }) =>
    storage.run({ ...start, after: context }, () => handle({ getRouter, request, executeRouter, context, executed, signal, event }));
  return await terminal({ context: { weight: 1 } });
}

const rounds = Number(process.env.ROUNDS ?? 2000);
let total = 0;
for (let round = 0; round < rounds; round++) {
  const batch = [];
  for (let i = 0; i < 16; i++) batch.push(resolveRequest({ id: i, text: "request " + round }, {}, { round }));
  for (const value of await Promise.all(batch)) total += value;
}
console.log(total);
