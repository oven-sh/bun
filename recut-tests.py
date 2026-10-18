# Builds the test file of the re-cut PR from the file at feab025f05.
src=open('/tmp/h2repro/mcs-feab.ts').read()
L=src.split('\n')
def seg(a,b): return '\n'.join(L[a-1:b])
s=src
def rep(old,new,count=1):
    global s
    assert s.count(old)==count,(s.count(old),old[:90])
    s=s.replace(old,new)
def cut(start, end):
    global s
    a=s.index(start); b=s.index(end, a)
    s=s[:a]+s[b:]

# header: both runtimes, with the last test running node
rep('''// Works with both:
// - bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
// - node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
''','''// All tests in this file run in both Bun and Node.js: `bun test` runs them here, and the last test
// runs this same file under Node.js. A test that is skipped there says "Bun only".
''')
rep('import { format } from "node:util";\n','import { fileURLToPath } from "node:url";\nimport { format } from "node:util";\n')
# outcome(): no events.once on the client socket, no listener on the sockets of the server
rep('''  // A session that has ended does not listen to its socket. The reset of the client can still arrive.
  server.on("connection", socket => socket.on("error", () => {}));
''','')
rep('''  else if (!client.closed) await once(client.socket, "close");
''','''  else await client.waitFor(() => false);
''')

# the same-read hold goes; two pins of the slot release stay
cut('''  // nghttp2 closes a stream when it writes the frame that ends it, and it writes after it has read
  // every frame of the chunk. So the slot of 1 is not free for 3 and 5.
  describe("a stream that the handler ended keeps its slot until the read ends", () => {''','''  // The same through the public API.''')
rep('''  // The same through the public API.''','''  // Bun only. Bun gives the slot back when the handler has ended the response. Node gives it back
  // when it has written the response, which can be after it has read 3 and 5.
  test("a request behind a stream that the handler ended in the same write is served", bunOnly, async () => {
    assert.deepStrictEqual(await withLimit(one, finish, inOneWrite(3)), allServed(odd(3)));
  });

  // The RST_STREAM of the peer closes the stream when the server reads it.
  test("a request behind a stream that the peer reset in the same write is served", async () => {
    const result = await withLimit(one, finish, async (client, served) => {
      // Node writes no frame for stream 1, so outcome() would not return.
      client.send(get(1), cancel(1), get(3));
      await client.waitFor(f => f.streamId === 3 && (f.type === HEADERS || f.type === RST_STREAM));
      return seen(client, served);
    });
    assert.deepStrictEqual(
      { handlers: result.handlers, refused: withCode(result.resets, REFUSED_STREAM) },
      { handlers: [1, 3], refused: [] },
    );
  });

  // RFC 9113 5.1: a HEADERS frame on a closed stream is not a new stream.
  test("a trailer block on a stream that the server reset does not take a slot", async () => {
    const resetFirst: OnStream = (stream, headers) => {
      if (stream.id === 1) stream.close(CANCEL);
      else hold(stream, headers);
    };
    const result = await withLimit(one, resetFirst, async (client, served) => {
      client.send(upload(1));
      await client.waitFor(f => f.type === RST_STREAM && f.streamId === 1);
      const field = Buffer.concat([Buffer.from([0x00]), literal("x-checksum"), literal("1")]);
      client.send(frame(HEADERS, END_STREAM | END_HEADERS, 1, field), get(3));
      await client.waitFor(f => f.streamId === 3 && (f.type === HEADERS || f.type === RST_STREAM));
      return seen(client, served);
    });
    assert.deepStrictEqual(
      { handlers: result.handlers, refused: withCode(result.resets, REFUSED_STREAM) },
      { handlers: [1, 3], refused: [] },
    );
  });

  // 1001 refusals are inside the default maxSessionInvalidFrames of 1000. The next one is not.
  test("the default budget keeps 1001 refused streams and ends the session at the next one", async () => {
    const count = (result: ReturnType<typeof seen>) => ({
      handlers: result.handlers.length,
      refused: withCode(result.resets, REFUSED_STREAM).length,
      goaways: result.goaways,
      sessionError: result.sessionError,
    });
    await withLimit({ settings: { maxConcurrentStreams: 10 } }, hold, async (client, served) => {
      client.send(...odd(1011).map(get));
      assert.deepStrictEqual(count(await outcome(client, served)), {
        handlers: 10,
        refused: 1001,
        goaways: [],
        sessionError: undefined,
      });
      client.send(get(2023));
      assert.deepStrictEqual(count(await outcome(client, served, 2)), {
        handlers: 10,
        refused: 1002,
        goaways: [INTERNAL_ERROR],
        sessionError: "ERR_HTTP2_TOO_MANY_INVALID_FRAMES",
      });
    });
  });

  // The same through the public API.''')

# the shared allowance, with no frame that depends on the timing inside one read
a=s.index('''  test("a refused stream and a malformed block use the same allowance", async () => {''')
b=s.index('''  test("a refused stream with a malformed block gets one RST_STREAM", async () => {''')
s=s[:a]+'''  test("a refused stream and a malformed block use the same allowance", async () => {
    const options = { settings: { maxConcurrentStreams: 2 }, maxSessionInvalidFrames: 1 };
    const result = await withLimit(options, hold, async (client, served) => {
      client.send(get(1), get(3));
      await client.waitFor(answered(3));
      // 5 is over the limit: the first invalid frame.
      client.send(get(5));
      await client.waitFor(answered(5));
      // 7 takes the slot of 3, and its block is malformed: the second invalid frame.
      client.send(cancel(3), malformed(7));
      await client.waitFor(answered(7));
      client.send(get(9));
      await client.waitFor(answered(9));
      // 11 is over the limit: the third invalid frame ends the session.
      client.send(get(11));
      return outcome(client, served);
    });
    // Node can reset the open streams with INTERNAL_ERROR when it ends the session.
    const resets = result.resets.filter(([, code]) => code !== INTERNAL_ERROR);
    assert.deepStrictEqual(
      { ...result, resets },
      {
        handlers: [1, 3, 9],
        answered: [1, 3, 9],
        resets: [
          [5, REFUSED_STREAM],
          [7, PROTOCOL_ERROR],
          [11, REFUSED_STREAM],
        ],
        goaways: [INTERNAL_ERROR],
        sessionError: "ERR_HTTP2_TOO_MANY_INVALID_FRAMES",
      },
    );
  });

'''+s[b:]

# the sendTrailers pair needs the hold
cut('''  // nghttp2 closes stream 1 when it writes the trailers, after it has read every frame of the
  // chunk. So 5 is over the limit.''','''  // Bun reads a top-level maxConcurrentStreams as a setting.''')

# the memory flight needs a held slot for a stream refused for memory
a=s.index('''  describe("and maxSessionMemory", () => {'''); b=s.index('''    test("DATA on a stream that was refused for memory gets no second RST_STREAM", async () => {''')
s=s[:a]+'''  describe("and maxSessionMemory", () => {
'''+s[b:]

# Node runs the same file
s=s.rstrip('\n')+'''

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
'''
open('/tmp/h2repro/mcs-core.test.ts','w').write(s)

# commit A: the pins only
a=s.index('/** A request whose block is malformed: it carries a `connection` field (RFC 9113 8.2.2). */')
b=s.index('// Only in Bun: when Node.js runs this file it must not spawn itself again.')
p1=s[:a].rstrip('\n')+'\n\n'+s[b:]
p1=p1.replace('import { spawn } from "node:child_process";\n','').replace('import { text } from "node:stream/consumers";\n','')
open('/tmp/h2repro/mcs-pins.test.ts','w').write(p1)
print(len(s.split('\n')), len(p1.split('\n')))
