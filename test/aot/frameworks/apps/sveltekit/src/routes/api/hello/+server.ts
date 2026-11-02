import { json, type RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ url }) => json({ hello: url.searchParams.get("name") ?? "nobody" });
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { numbers: number[] };
  return json({ sum: body.numbers.reduce((a, b) => a + b, 0) }, { status: 201, headers: { "x-made-by": "route" } });
};
