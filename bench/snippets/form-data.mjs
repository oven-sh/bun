// so it can run in environments without node module resolution
import { bench, run } from "../runner.mjs";

const blob = new Blob(["foo", "bar", "baz"]);
bench("FormData.append", () => {
  const data = new FormData();
  data.append("foo", "bar");
  data.append("baz", blob);
});

const data = new FormData();
data.append("foo", "bar");
data.append("baz", blob);

const formText =
  // single field form data
  "--Form\r\n" + 'Content-Disposition: form-data; name="foo"\r\n\r\n' + "bar\r\n" + "--Form--\r\n";

bench("response.formData()", async () => {
  await new Response(formText, {
    headers: {
      "Content-Type": "multipart/form-data; boundary=Form",
    },
  }).formData();
});
// Parsing by body shape. The payload and the boundary decide how many
// candidates the delimiter search looks at, so each is its own case.
const encoder = new TextEncoder();
function randomBytes(length) {
  const out = new Uint8Array(length);
  let x = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x;
  }
  return out;
}
// Lines of 20 to 79 digits.
function digitLines(length, lineEnd) {
  const out = new Uint8Array(length);
  let x = 0x9e3779b9;
  let i = 0;
  while (i < length) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    for (let left = 20 + ((x >>> 8) % 60); left > 0 && i < length; left--) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      out[i++] = 0x30 + ((x >>> 8) % 10);
    }
    for (const byte of lineEnd) if (i < length) out[i++] = byte;
  }
  return out;
}
const payloads = {
  "binary": length => randomBytes(length),
  "CRLF digit text": length => digitLines(length, [13, 10]),
  "LF digit text": length => digitLines(length, [10]),
};
const boundaries = {
  "WebKit": "----WebKitFormBoundary7MA4YWxkTrZu0gW",
  "24 dashes + 16 hex": "------------------------d74496d66958873e",
  "26 dashes + 24 digits": "--------------------------904291748201472950381746",
};
function fileBody(boundary, payload) {
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + payload.length + tail.length);
  body.set(head, 0);
  body.set(payload, head.length);
  body.set(tail, head.length + payload.length);
  return body;
}
function benchParse(name, boundary, body) {
  const headers = { "Content-Type": `multipart/form-data; boundary=${boundary}` };
  bench(name, async () => {
    await new Response(body, { headers }).formData();
  });
}

{
  const boundary = boundaries["WebKit"];
  let fields = "";
  for (let i = 0; i < 10; i++) {
    fields += `--${boundary}\r\nContent-Disposition: form-data; name="field${i}"\r\n\r\nvalue number ${i}\r\n`;
  }
  benchParse("response.formData(): 10 fields", boundary, encoder.encode(fields + `--${boundary}--\r\n`));
}
for (const [size, length] of [
  ["64 KB", 64 << 10],
  ["1 MB", 1 << 20],
  ["16 MB", 16 << 20],
]) {
  for (const [payloadName, payload] of Object.entries(payloads)) {
    for (const [boundaryName, boundary] of Object.entries(boundaries)) {
      // Every boundary style at the largest size, the browser one at each size.
      if (boundaryName !== "WebKit" && size !== "16 MB") continue;
      benchParse(
        `response.formData(): ${size} ${payloadName}, ${boundaryName} boundary`,
        boundary,
        fileBody(boundary, payload(length)),
      );
    }
  }
}

bench("new Response(formData).text()", async () => {
  await new Response(data).text();
});

bench("new Response(formData).formData()", async () => {
  await new Response(data).formData();
});

await run();
