import { createCookieSessionStorage } from "react-router";

const storage = createCookieSessionStorage<{ visits: number }>({ cookie: { name: "session", path: "/", sameSite: "lax", secrets: ["another secret"] } });

export async function loader({ request }: { request: Request }) {
  const session = await storage.getSession(request.headers.get("cookie"));
  session.set("visits", (session.get("visits") ?? 0) + 1);
  return Response.json({ visits: session.get("visits") }, { headers: { "set-cookie": await storage.commitSession(session) } });
}
