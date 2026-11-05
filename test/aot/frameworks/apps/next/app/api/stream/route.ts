export const dynamic = "force-dynamic";

export function GET() {
  const encoder = new TextEncoder();
  let sent = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      if (sent === 3) return controller.close();
      await new Promise(resolve => setTimeout(resolve, 2));
      controller.enqueue(encoder.encode("chunk " + ++sent + "\n"));
    },
  }), { headers: { "content-type": "text/plain", "x-made-by": "a stream" } });
}
