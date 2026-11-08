export default defineEventHandler(async event => {
  const body = await readBody<{ numbers: number[] }>(event);
  setResponseStatus(event, 201);
  setResponseHeader(event, "x-made-by", "route");
  return { sum: body.numbers.reduce((a, b) => a + b, 0) };
});
