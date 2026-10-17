export async function loader({ request }: { request: Request }) {
  return Response.json({ hello: new URL(request.url).searchParams.get("name") ?? "nobody" });
}

export async function action({ request }: { request: Request }) {
  const body = (await request.json()) as { numbers: number[] };
  return Response.json({ sum: body.numbers.reduce((a, b) => a + b, 0) }, { status: 201, headers: { "x-made-by": "route" } });
}
