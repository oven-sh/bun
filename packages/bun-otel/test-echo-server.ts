// Simple echo server for testing - returns all request headers as JSON
// Run as a separate process to avoid instrumentation

if (import.meta.main) {
  const server = Bun.serve({
    port: parseInt(process.env.PORT || "0"),
    fetch(req) {
      const url = new URL(req.url);

      // Shutdown endpoint for clean teardown
      if (url.pathname === "/shutdown") {
        server.stop();
        return new Response("shutting down", { status: 200 });
      }

      // Echo all request headers
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return Response.json({ headers });
    },
  });

  console.log(`Echo server listening on ${server.port}`);
}

// Controller for managing echo server in tests
export class EchoServer {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private port: number | null = null;

  async start(): Promise<void> {
    const { bunEnv, bunExe } = await import("../../test/harness");

    this.proc = Bun.spawn([bunExe(), "packages/bun-otel/test-echo-server.ts"], {
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    // Read the port from stdout with a real timeout using Promise.race
    const decoder = new TextDecoder();
    const timeoutMs = 5000;

    try {
      this.port = await Promise.race([
        (async () => {
          for await (const chunk of this.proc!.stdout) {
            const text = decoder.decode(chunk);
            const match = text.match(/listening on (\d+)/);
            if (match) return parseInt(match[1]);
          }
          throw new Error("Echo server exited before reporting port");
        })(),
        (async () => {
          await Bun.sleep(timeoutMs);
          throw new Error("Echo server failed to start within 5 seconds");
        })(),
      ]);
    } catch (err) {
      if (this.proc) {
        this.proc.kill();
        this.proc = null;
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.port) {
      // Send graceful shutdown request
      try {
        const { $ } = await import("bun");
        await $`curl -s http://localhost:${this.port}/shutdown`.quiet();
      } catch {
        // Ignore errors during shutdown request
      }
    }

    if (this.proc) {
      // Wait for graceful exit (up to 2 seconds), then force-kill if needed
      await Promise.race([this.proc.exited, Bun.sleep(2000)]).catch(() => {});
      this.proc.kill();
      await this.proc.exited.catch(() => {});
      this.proc = null;
    }

    this.port = null;
  }

  getUrl(path: string = "/"): string {
    if (!this.port) {
      throw new Error("Echo server not started");
    }
    return `http://127.0.0.1:${this.port}${path}`;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
