# Adds the tests of the exact slot timing to the converted file, and rewrites the old budget test.
p='/tmp/h2repro/mcs-full.test.ts'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count,(s.count(old),old[:90])
    s=s.replace(old,new)
rep('''    // The RST_STREAM of the peer closes the stream when the server reads it.
    test("but not when the peer resets it in the same write", async () => {''','''    // Stream 1 is from an earlier read. The handler ends it at the first DATA frame of this read.
    test("when a stream from an earlier read ends on both sides in this read", async () => {
      const answerAtData: OnStream = (stream, headers) => {
        stream.once("data", () => finish(stream, headers));
      };
      const result = await withLimit(one, answerAtData, async (client, served) => {
        client.send(upload(1));
        await client.ping(1);
        client.send(frame(DATA, 0, 1, Buffer.from("body")), endOfBody(1), get(3));
        return outcome(client, served, 2);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: refused([3]),
        goaways: [],
        sessionError: undefined,
      });
    });

    // The handler feeds the next requests to the session from inside the read.
    test("for the bytes that a handler pushes into the Duplex of the session", async () => {
      const served: Served = { handlers: [] };
      const server = net.createServer(socket => {
        const duplex = new Duplex({
          read() {},
          write(chunk, _encoding, callback) {
            socket.write(chunk, callback);
          },
        });
        socket.on("data", chunk => duplex.push(chunk));
        socket.on("error", () => {});
        record(http2.performServerHandshake(duplex, one), served, (stream, headers) => {
          finish(stream, headers);
          if (stream.id === 1) duplex.push(Buffer.concat([get(3), get(5)]));
        });
      });
      const result = await withClient(server, async client => {
        client.send(get(1));
        await client.waitFor(ended(1));
        await client.waitFor(f => f.type === RST_STREAM && f.streamId === 5);
        return seen(client, served);
      });
      assert.deepStrictEqual(result, {
        handlers: [1],
        answered: [1],
        resets: refused([3, 5]),
        goaways: [],
        sessionError: undefined,
      });
    });

    // The RST_STREAM of the peer closes the stream when the server reads it.
    test("but not when the peer resets it in the same write", async () => {''')
open(p,'w').write(s)

q='/workspace/bun/test/js/node/http2/node-http2-rejected-streams.test.ts'
t=open(q).read()
a=t.index('  // Bun-only, kept from 1.4.x: node v26.3.0 answers 3, 5 and 7 with RST_STREAM(REFUSED_STREAM),')
b=t.index('      }).toEqual({', a)
c=t.index('      });\n', b)+len('      });\n')
old=t[a:c]
new='''  // Node charges this refusal to maxSessionInvalidFrames, so maxSessionRejectedStreams plays no part.
  test("a stream refused over maxConcurrentStreams does not use maxSessionRejectedStreams", async () => {
    const seen: number[] = [];
    let sessionErrorCode: string | undefined;
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 }, maxSessionRejectedStreams: 3 });
    server.on("sessionError", (err: NodeJS.ErrnoException) => (sessionErrorCode = err.code));
    server.on("session", session => session.on("error", () => {}));
    server.on("stream", stream => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.write("hello");
    });
    const client = await RawClient.connect(server);
    try {
      client.get(1);
      await client.waitFor(f => f.type === HEADERS && f.streamId === 1);
      for (const streamId of [3, 5, 7]) client.get(streamId);
      await client.waitFor(f => f.type === GOAWAY || (f.type === RST_STREAM && f.streamId === 7));
      expect({
        seen,
        resets: client.resets(),
        acked: await client.ping(1),
        goaways: client.goawayCodes(),
        sessionErrorCode,
      }).toEqual({
        seen: [1],
        resets: [
          [3, REFUSED_STREAM],
          [5, REFUSED_STREAM],
          [7, REFUSED_STREAM],
        ],
        acked: true,
        goaways: [],
        sessionErrorCode: undefined,
      });
'''
t=t[:a]+new+t[c:]
open(q,'w').write(t)
print('posted')
