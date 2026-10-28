export const runtime = "edge";

export function GET(request: Request) {
  return Response.json({ runtime: typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime, path: new URL(request.url).pathname, sum: [1, 2, 3].reduce((a, b) => a + b, 0) });
}
