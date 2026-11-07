import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const jar = await cookies();
  jar.set("who", "ada", { httpOnly: true, path: "/", sameSite: "lax" });
  jar.set("second", "1");
  return NextResponse.json({ set: jar.getAll().map(cookie => cookie.name).sort() });
}
