// Minimal Chrome DevTools Protocol driver: one headless Chrome, pages on demand.
import { spawn } from "bun";

export class Chrome {
  proc: ReturnType<typeof spawn>;
  ws!: WebSocket;
  id = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  listeners = new Map<string, ((params: any, sessionId?: string) => void)[]>();

  static async launch(): Promise<Chrome> {
    const c = new Chrome();
    c.proc = spawn({
      cmd: [
        "google-chrome",
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--remote-debugging-port=0",
        "--user-data-dir=/tmp/css-order-check/profile-" + process.pid,
        "about:blank",
      ],
      stderr: "pipe",
      stdout: "ignore",
    });
    const reader = (c.proc.stderr as ReadableStream<Uint8Array>).getReader();
    let buf = "";
    let url = "";
    while (!url) {
      const { value, done } = await reader.read();
      if (done) throw new Error("chrome exited: " + buf);
      buf += new TextDecoder().decode(value);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) url = m[1];
    }
    reader.releaseLock();
    c.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      c.ws.onopen = () => resolve();
      c.ws.onerror = e => reject(e);
    });
    c.ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = c.pending.get(msg.id);
        if (p) {
          c.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const l of c.listeners.get(msg.method) ?? []) l(msg.params, msg.sessionId);
      }
    };
    return c;
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method: string, fn: (params: any, sessionId?: string) => void) {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  /** Loads `url` with the given emulated media type and evaluates `expression` after the load event. */
  async evaluate(url: string, media: string, expression: string, viewport?: { width: number; height: number }): Promise<any> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Emulation.setEmulatedMedia", { media }, sessionId);
    if (viewport)
      await this.send(
        "Emulation.setDeviceMetricsOverride",
        { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
    const loaded = new Promise<void>(resolve => {
      const fn = (_: any, sid?: string) => {
        if (sid === sessionId) resolve();
      };
      this.on("Page.loadEventFired", fn);
    });
    await this.send("Page.navigate", { url }, sessionId);
    await loaded;
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    await this.send("Target.closeTarget", { targetId });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result.value;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    await this.proc.exited;
  }
}
