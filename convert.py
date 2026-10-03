# Builds node-http2-max-concurrent-streams.test.ts (node:test, node:assert) from the bun:test
# version of the tests at ad5459af1c (saved as /tmp/rs-head.ts).
import re, sys
src = open('/tmp/rs-head.ts').read().split('\n')
def seg(a, b):  # 1-based inclusive
    return '\n'.join(src[a-1:b])

def convert_expect(code):
    out = []
    i = 0
    while True:
        j = code.find('expect(', i)
        if j < 0:
            out.append(code[i:]); break
        out.append(code[i:j])
        k = j + len('expect(')
        depth = 1
        while depth:
            c = code[k]
            if c in '([{': depth += 1
            elif c in ')]}': depth -= 1
            elif c in '"\'`':
                q = c; k += 1
                while code[k] != q:
                    if code[k] == '\\': k += 1
                    k += 1
            k += 1
        inner = code[j+len('expect('):k-1]
        rest = code[k:]
        if rest.startswith('.toEqual('):
            out.append('assert.deepStrictEqual(' + inner + ', ')
            i = k + len('.toEqual(')
        elif rest.startswith('.not.toContain('):
            m = re.match(r'\.not\.toContain\(([^)]*)\);', rest)
            out.append('assert.ok(!' + inner + '.includes(' + m.group(1) + '), ' + inner + ');')
            i = k + m.end()
        else:
            raise SystemExit('unhandled matcher after expect(' + inner[:40] + '): ' + rest[:30])
    return ''.join(out)

def convert(code):
    code = convert_expect(code)
    code = code.replace('test.skipIf(typeof Bun === "undefined").each(', 'each(')
    code = code.replace('test.each(', 'each(').replace('describe.each(', 'describeEach(')
    code = code.replace('])("after respond() failed for %s", async', '], bunOnly)("after respond() failed for %s", async')
    code = code.replace('])("a stream whose respond() failed and that %s gives back one slot", async', '], bunOnly)("a stream whose respond() failed and that %s gives back one slot", async')
    return code

header = '''// Works with both:
// - bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
// - node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
import assert from "node:assert";
%(extra_imports_1)simport { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
%(extra_imports_2)simport { describe, test } from "node:test";
import tls from "node:tls";
import { format } from "node:util";

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsCert = {
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem"), "utf8"),
  key: fs.readFileSync(path.join(keys, "agent1-key.pem"), "utf8"),
};
const bunOnly = { skip: typeof Bun === "undefined" };

/** `test.each` of bun:test: one test for each row, and the row is the argument list of `body`. */
function each(rows: readonly unknown[], options: { skip?: boolean } = {}) {
  return (name: string, body: (...row: any[]) => unknown) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%%[sd]/g)?.length ?? 0;
      test(format(name, ...args.slice(0, used)), options, () => body(...args));
    }
  };
}

/** `describe.each` of bun:test. */
function describeEach(rows: readonly unknown[]) {
  return (name: string, body: (...row: any[]) => void) => {
    for (const row of rows) {
      const args = Array.isArray(row) ? row : [row];
      const used = name.match(/%%[sd]/g)?.length ?? 0;
      describe(format(name, ...args.slice(0, used)), () => body(...args));
    }
  };
}
'''
consts = seg(15, 68)
raw = seg(70, 166)
a = '''  constructor(readonly socket: net.Socket) {
    socket.on("error", () => {});'''
assert a in raw
raw = raw.replace(a, '''  socket: net.Socket;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("error", () => {});''')
helpers = seg(342, 536)
pins = convert(seg(538, 924))
pr2 = convert(seg(926, 1401))

old_tail = '''      const child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio: ["ignore", "pipe", "pipe"] });'''
assert old_tail in pr2, 'spawn line'
pr2 = pr2.replace(old_tail, '''      const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
      const child = spawn(process.execPath, ["-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });''')
m = re.search(r'  test\(\n    "an \'aborted\' listener that throws does not keep the slot",\n    async \(\) => \{', pr2)
assert m, 'aborted test head'
pr2 = pr2[:m.start()] + '''  // The child is a debug build in CI, and it needs more than the default timeout to start.
  test(
    "an 'aborted' listener that throws does not keep the slot",
    { timeout: 60_000 },
    async () => {''' + pr2[m.end():]
m = re.search(r'    \},\n    10_000 \* \(isDebug \? 10 : isASAN \? 3 : 1\),\n  \);', pr2)
assert m, 'aborted test tail'
pr2 = pr2[:m.start()] + '    },\n  );' + pr2[m.end():]

full = header % {'extra_imports_1': 'import { spawn } from "node:child_process";\n', 'extra_imports_2': 'import { text } from "node:stream/consumers";\n'} + '\n' + consts + '\n\n' + raw + '\n\n' + helpers + '\n\n' + pins + '\n\n' + pr2 + '\n'
pr1 = header % {'extra_imports_1': '', 'extra_imports_2': ''} + '\n' + consts + '\n\n' + raw + '\n\n' + helpers + '\n\n' + pins + '\n'
open('/tmp/h2repro/mcs-full.test.ts', 'w').write(full)
open('/tmp/h2repro/mcs-pr1.test.ts', 'w').write(pr1)
print('full', len(full.split('\n')), 'pr1', len(pr1.split('\n')))
