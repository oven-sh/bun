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

    // Read the port from stdout with timeout
    const decoder = new TextDecoder();
    const startTime = Date.now();
    const timeoutMs = 5000;

    for await (const chunk of this.proc.stdout) {
      const text = decoder.decode(chunk);
      const match = text.match(/listening on (\d+)/);
      if (match) {
        this.port = parseInt(match[1]);
        break;
      }

      if (Date.now() - startTime > timeoutMs) {
        await this.stop();
        throw new Error("Echo server failed to start within 5 seconds");
      }
    }

    if (!this.port) {
      await this.stop();
      throw new Error("Echo server did not report listening port");
    }
  }

  async stop(): Promise<void> {
    if (this.port) {
      // Send shutdown request
      try {
        const { $ } = await import("bun");
        await $`curl -s http://localhost:${this.port}/shutdown`.quiet();
      } catch {
        // Ignore errors during shutdown
      }
    }

    if (this.proc) {
      this.proc.kill();
      await this.proc.exited;
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
