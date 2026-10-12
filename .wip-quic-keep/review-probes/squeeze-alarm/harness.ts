// Scratch harness for the coverage-gap probe. The client and the relay run in
// this process (so BUN_DEBUG_lsquic shows the client only); the server runs in
// a child process with the unpatched branch build.
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { connect } from "node:quic";

export const LARGE = 1100;
export const MEDIUM = 750;
export const SMALL = 200;
export const CHUNK = 300;
const SERVER_BUN = "/workspace/bun/build/debug/bun-debug";

export type Dir = "c" | "s";
export type Action = "pass" | "drop" | "hold";
const short = (packet: Buffer) => !(packet[0] & 0x80);
export const kindOf = (packet: Buffer) => {
  if (!short(packet)) return "long" + packet.length;
  const n = packet.length;
  if (n >= 1400) return "MTU" + n;
  if (n >= LARGE) return "L" + n;
  if (n >= MEDIUM) return "M" + n;
  if (n >= 3 * SMALL) return "S3_" + n;
  if (n >= CHUNK) return "C" + n;
  if (n >= SMALL) return "s" + n;
  return "o" + n;
};

export async function setup(opts: { idle?: number; echo?: boolean; clientOptions?: any } = {}) {
  const idle = opts.idle ?? 30;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "BUN_DEBUG_lsquic") env[k] = v;
  env.BUN_DEBUG_QUIET_LOGS = "1";
  const proc = Bun.spawn({
    cmd: [SERVER_BUN, "/tmp/cg3/server.ts", String(idle), opts.echo ? "echo" : "noecho"],
    env,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "pipe",
  });
  const received: number[] = [];
  let streamBytes = 0;
  let serverClosed = false;
  let onServer = () => {};
  let port = 0;
  const gotPort = Promise.withResolvers<void>();
  (async () => {
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout as any) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        const msg = JSON.parse(line);
        if (msg.port) {
          port = msg.port;
          gotPort.resolve();
        }
        if (msg.dg !== undefined) received.push(msg.dg);
        if (msg.stream !== undefined) streamBytes = msg.stream;
        if (msg.closed) serverClosed = true;
        onServer();
      }
    }
  })();
  await gotPort.promise;

  // The relay.
  const front = createSocket("udp4");
  const upstream = createSocket("udp4");
  let clientPort = 0;
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const trace: string[] = [];
  const held: Record<Dir, Buffer[]> = { c: [], s: [] };
  const relay = {
    port: 0,
    /** What to do with a packet from the client ("c") or the server ("s"). */
    decide: (_packet: Buffer, _dir: Dir): Action => "pass",
    onPacket: (_packet: Buffer, _dir: Dir, _action: Action) => {},
    held,
    trace,
    mark(label: string) {
      trace.push(`[${label}@${now()}]`);
    },
    forward(packet: Buffer, dir: Dir) {
      if (dir === "c") upstream.send(packet, port, "127.0.0.1");
      else front.send(packet, clientPort, "127.0.0.1");
    },
    close() {
      front.close();
      upstream.close();
    },
  };
  const handle = (packet: Buffer, dir: Dir) => {
    const action = relay.decide(packet, dir);
    trace.push(`${dir}:${kindOf(packet)}${action === "pass" ? "" : action === "drop" ? "x" : "h"}@${now()}`);
    if (action === "pass") relay.forward(packet, dir);
    else if (action === "hold") held[dir].push(packet);
    relay.onPacket(packet, dir, action);
  };
  upstream.on("message", packet => handle(packet, "s"));
  front.on("message", (packet, from) => {
    clientPort = from.port;
    handle(packet, "c");
  });
  front.bind(0, "127.0.0.1");
  upstream.bind(0, "127.0.0.1");
  await Promise.all([once(front, "listening"), once(upstream, "listening")]);
  relay.port = front.address().port;

  const statuses = new Map<number, string[]>();
  let onStatus = () => {};
  /** Runs synchronously inside the session's ondatagramstatus callback. */
  const hooks = { inStatus: (_id: number, _status: string) => {} };
  let clientClosed: string | undefined;
  const client = await connect(
    { address: "127.0.0.1", port: relay.port },
    {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: idle },
      onerror() {},
      ondatagram() {},
      ondatagramstatus(id: bigint, status: string) {
        statuses.set(Number(id), [...(statuses.get(Number(id)) ?? []), status]);
        trace.push(`{${id}:${status}@${now()}}`);
        hooks.inStatus(Number(id), status);
        onStatus();
      },
      ...(opts.clientOptions ?? {}),
    },
  );
  await client.opened;
  client.closed.then(
    () => (clientClosed = "closed"),
    (e: Error) => (clientClosed = "error: " + e.message),
  );

  const until = (done: () => boolean, listen: (check: () => void) => void) =>
    new Promise<void>(resolve => {
      const check = () => done() && resolve();
      listen(check);
      check();
    });
  let count = 0;
  /** Sends a datagram of `size` bytes. Returns its id: ids count from 1. */
  const send = (size = LARGE) => {
    client.sendDatagram(Buffer.alloc(size, ++count));
    return count;
  };
  const status = (id: number) =>
    until(
      () => statuses.has(id),
      check => (onStatus = check),
    ).then(() => statuses.get(id)![0]);
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  return {
    client,
    relay,
    hooks,
    send,
    status,
    sleep,
    tick,
    now,
    received: () => received.toSorted((a, b) => a - b),
    streamBytes: () => streamBytes,
    statuses: () => Object.fromEntries(statuses),
    clientClosed: () => clientClosed,
    serverClosed: () => serverClosed,
    /** Waits until `done()` holds on the server side, or `ms` passed. Returns whether it holds. */
    async serverUntil(done: () => boolean, ms: number) {
      const deadline = performance.now() + ms;
      while (!done() && performance.now() < deadline) await sleep(20);
      return done();
    },
    /** Round trips, so the retransmission timers of the client are short. */
    async warmUp(n = 24) {
      for (let i = 0; i < n; i += 2) {
        send();
        const s = await status(send());
        if (s !== "acknowledged") throw new Error("warm-up datagram " + count + " " + s);
      }
    },
    async stream() {
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      return {
        stream,
        write: (size: number) => void stream.writer.writeSync(new Uint8Array(size)),
      };
    },
    async [Symbol.asyncDispose]() {
      relay.decide = () => "pass";
      try {
        client.destroy();
      } catch {}
      await sleep(50);
      proc.kill();
      await proc.exited;
      relay.close();
    },
  };
}
