export default defineEventHandler(() => {
  throw createError({ statusCode: 418, statusMessage: "a teapot", data: { why: "asked for coffee" } });
});
