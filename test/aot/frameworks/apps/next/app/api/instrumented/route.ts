export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ registeredBy: (globalThis as { registeredBy?: string }).registeredBy ?? null });
}
