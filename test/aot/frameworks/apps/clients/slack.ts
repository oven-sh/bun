import { LogLevel, WebClient } from "@slack/web-api";

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const form = new URLSearchParams(await request.text());
    if (new URL(request.url).pathname.endsWith("chat.postMessage"))
      return Response.json({ ok: true, channel: form.get("channel"), ts: "1.2", message: { text: form.get("text") } });
    return Response.json({ ok: false, error: "unknown_method" });
  },
});
const web = new WebClient("test-token", {
  slackApiUrl: `http://localhost:${server.port}/api/`,
  logLevel: LogLevel.ERROR,
  retryConfig: { retries: 0 },
});
const result = await web.chat.postMessage({ text: "Hello world!", channel: "C123" });
console.log(result.ok, result.channel, result.ts, result.message?.text);
try {
  await web.apiCall("nothing.here");
} catch (error) {
  console.log((error as { code: string }).code, (error as { data: { error: string } }).data.error);
}
server.stop(true);
