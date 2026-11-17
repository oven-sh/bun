export default defineEventHandler(event => {
  event.context.seen = "yes";
  setResponseHeader(event, "x-middleware-ran", getRequestURL(event).pathname);
});
