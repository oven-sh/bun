export default defineEventHandler(async event => {
  const query = await getValidatedQuery(event, raw => {
    const n = Number((raw as { n?: string }).n);
    if (!Number.isInteger(n)) throw new TypeError("n must be a whole number");
    return { n };
  });
  return { squared: query.n ** 2, seen: event.context.seen };
});
