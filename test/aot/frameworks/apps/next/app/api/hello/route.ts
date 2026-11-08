import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json({ hello: request.nextUrl.searchParams.get("name") ?? "nobody", seenByMiddleware: request.headers.get("x-from-middleware") });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { numbers: number[] };
  return NextResponse.json({ sum: body.numbers.reduce((a, b) => a + b, 0) }, { status: 201, headers: { "x-made-by": "route" } });
}
