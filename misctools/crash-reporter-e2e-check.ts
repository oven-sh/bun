// this can not be a part of the ./test test suite because PR builds do not get
// added, as those are remapped on the CI machine itself.
//
// This test does not test Bun, but instead it tests:
// - Bun's CI has uploaded symbols to the bucket the crash reporter uses.
// - bun.report itself is able to download and remap it.
import { expect, test } from "bun:test";
import { mergeWindowEnvs, bunEnv } from '../test/harness';

async function run() {
  let sent = false;
  let key;
  const resolve_handler = Promise.withResolvers();
  
  // Self host the crash report backend.
  using server = Bun.serve({
    port: 0,
    fetch(request, server) {
      expect(request.url).toEndWith("/ack");
      // remove '/' and '/ack'
      key = new URL(request.url).pathname.slice(1, -4);
      sent = true;
      resolve_handler.resolve();
      return new Response("OK");
    },
  });
  
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      '-e',
      `require("bun:internal-for-testing").crash_handler.panic()`
    ],
    env: mergeWindowEnvs([
      bunEnv,
      {
        BUN_CRASH_REPORT_URL: server.url.toString(),
        BUN_ENABLE_CRASH_REPORTING: "1",
        GITHUB_ACTIONS: undefined,
        CI: undefined,
      },
    ]),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = await proc.exited;
  const stderr = await Bun.readableStreamToText(proc.stderr);
  
  await resolve_handler.promise;
  
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(server.url.toString());
  expect(sent).toBe(true);

  
  const response = await fetch("https://bun.report/remap", {
    method: "POST",
    body: key,
  });

  const result_text = await response.text();

  if(response.status === 400) {
    console.error(result_text);
    console.error('HTTP 400 - Fault of bun.report or crash_handler.zig encoding a trace string')
    return 1;
  }

  let json;
  try {
    json = JSON.parse(result_text);
  } catch (e) {
    console.error(e);
    console.error('Invalid JSON - Fault of bun.report')
    return 1;
  }

  if (json.error) {
    if(json.error.includes("Could not find debug info")) {
      console.error('Invalid JSON - Fault of CI not uploading symbols to S3 bucket.')
      console.error('You can debug this further by using ./bin/remap in https://github.com/oven-sh/bun.report')
      return 1;
    }

    console.error(json.error)
    console.error('Failure - Fault of bun.report not able to remap this trace.')
    console.error('You can debug this further by using ./bin/remap in https://github.com/oven-sh/bun.report')
    return 1;
  }

  expect(json.addresses[0].remapped).toBe(true);
  expect(json.addresses[0].function).toInclude('toJSHostFunction');
  expect(json.addresses[0].function).toInclude('.function');

  console.log('Crash reporter self test complete.');
}

process.exit(await run());
