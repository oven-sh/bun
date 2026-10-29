export default defineEventHandler(event => ({ hello: getQuery(event).name ?? "nobody", seenByMiddleware: event.context.seen }));
