#!/usr/bin/env python3
"""Builds the rewritten bunx.test.ts from HEAD's file and /tmp/probe/new-block.ts. argv[1] = output path."""
import subprocess, sys
src = subprocess.check_output(["git", "-C", "/workspace/bun", "show", "origin/main:test/cli/install/bunx.test.ts"]).decode()
block = open("/tmp/probe/new-block.ts", encoding="utf-8").read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

# helpers: the registry records credentials, the sandbox runs from a subdirectory
src = rep(src, '''function fixtureServer(handler: (pathname: string) => Uint8Array<ArrayBuffer> | object | undefined) {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
''', '''function fixtureServer(handler: (pathname: string) => Uint8Array<ArrayBuffer> | object | undefined) {
  const requests: string[] = [];
  const authorization: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      authorization.push(request.headers.get("authorization"));
''')
src = rep(src, '''    /** Every request path received so far, in order. */
    requests,
    url: server.url.origin,
''', '''    /** Every request path received so far, in order. */
    requests,
    /** The `authorization` header of each of them. */
    authorization,
    url: server.url.origin,
''')
src = rep(src, '''    /** `bun x ...args` (or `...bunx ...args`). `requests` is what the registry was asked for meanwhile. */
    async run(
      args: string[],
      {
        bunx = [bunExe(), "x"],
        ...options
      }: { bunx?: string[]; env?: Record<string, string | undefined>; uid?: number; gid?: number } = {},
    ) {
      const first = registry?.requests.length ?? 0;
      await using proc = spawn({
        cmd: [...bunx, ...args],
        cwd,
''', '''    /**
     * `bun x ...args` (or `...bunx ...args`) in `cwd`, or in its subdirectory `from`.
     * `requests` is what the registry was asked for meanwhile.
     */
    async run(
      args: string[],
      {
        bunx = [bunExe(), "x"],
        from = ".",
        ...options
      }: {
        bunx?: string[];
        from?: string;
        env?: Record<string, string | undefined>;
        uid?: number;
        gid?: number;
      } = {},
    ) {
      const first = registry?.requests.length ?? 0;
      await using proc = spawn({
        cmd: [...bunx, ...args],
        cwd: join(cwd, from),
''')
src = rep(src, '''  mkdirSync,
  readdirSync,
''', '''  mkdirSync,
  readdirSync,
  readFileSync,
''')
assert src.endswith("});\n")
src = src + "\n" + block
open(sys.argv[1], "w", encoding="utf-8").write(src)
print("wrote", sys.argv[1], len(src.splitlines()), "lines")
