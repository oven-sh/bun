import { json, type RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ cookies }) => {
  cookies.set("who", "ada", { path: "/", httpOnly: true, sameSite: "lax", secure: false });
  cookies.delete("gone", { path: "/" });
  return json({ had: cookies.getAll().map(cookie => cookie.name).sort() });
};
