import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname === "/old") return context.redirect("/", 307);
  context.locals.seen = "yes";
  const response = await next();
  response.headers.set("x-middleware-ran", context.url.pathname);
  return response;
});
