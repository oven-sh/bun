import type { APIRoute } from "astro";

export const GET: APIRoute = ({ url }) => Response.json({ hello: url.searchParams.get("name") ?? "nobody" });
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json()) as { numbers: number[] };
  return Response.json({ sum: body.numbers.reduce((a, b) => a + b, 0) }, { status: 201, headers: { "x-made-by": "route" } });
};
