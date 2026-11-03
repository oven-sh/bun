export default defineEventHandler(event => {
  setResponseHeader(event, "cache-control", "public, max-age=60");
  return "a route outside /api, by " + getMethod(event);
});
