import type { APIRoute } from "astro";

export const GET: APIRoute = ({ cookies }) => {
  const had = cookies.get("kept")?.value ?? null;
  cookies.set("who", "ada", { path: "/", httpOnly: true, sameSite: "lax" });
  cookies.delete("gone", { path: "/" });
  return Response.json({ had });
};
