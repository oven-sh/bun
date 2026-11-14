import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/old") return NextResponse.redirect(new URL("/", request.url));
  if (request.nextUrl.pathname === "/rewritten") return NextResponse.rewrite(new URL("/person/7?greeting=rewrite", request.url));
  const headers = new Headers(request.headers);
  headers.set("x-from-middleware", "yes");
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-middleware-ran", request.nextUrl.pathname);
  return response;
}

export const config = { matcher: ["/old", "/rewritten", "/api/:path*", "/data"] };
