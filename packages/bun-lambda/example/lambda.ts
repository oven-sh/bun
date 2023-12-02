import type { Server, ServerWebSocket } from "bun";

export default {
  async fetch(request: Request, server: Server): Promise<Response | undefined> {
    console.log("Request", {
      url: request.url,
      method: request.method,
      headers: request.headers.toJSON(),
      body: request.body ? await request.text() : null,
    });
    if (server.upgrade(request)) {
      console.log("WebSocket upgraded");
      return;
    }
    return new Response("Hello from Bun on Lambda!", {
      status: 200,
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
    });
  },
  websocket: {
    async open(ws: ServerWebSocket): Promise<void> {
      console.log("WebSocket opened");
    },
    async message(ws: ServerWebSocket, message: string): Promise<void> {
      console.log("WebSocket message", message);
    },
    async close(ws: ServerWebSocket, code: number, reason?: string): Promise<void> {
      console.log("WebSocket closed", { code, reason });
    },
  },
};
