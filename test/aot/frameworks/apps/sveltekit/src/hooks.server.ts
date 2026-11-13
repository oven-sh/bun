import type { Handle, HandleServerError } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals = { ...event.locals, seen: "yes" } as App.Locals;
  const response = await resolve(event);
  response.headers.set("x-middleware-ran", event.url.pathname);
  return response;
};

export const handleError: HandleServerError = ({ error, status }) => ({ message: "the hook saw " + (error as Error).name + " with " + status });
