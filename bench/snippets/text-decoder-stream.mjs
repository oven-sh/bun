import { bench, run } from "./runner.mjs";

const latin1 = `hello hello hello!!!! `.repeat(10240);

function create(src) {
  function split(str, chunkSize) {
    let chunkedHTML = [];
    let html = str;
    const encoder = new TextEncoder();
    while (html.length > 0) {
      chunkedHTML.push(encoder.encode(html.slice(0, chunkSize)));
      html = html.slice(chunkSize);
    }
    return chunkedHTML;
  }

  async function runBench(chunks) {
    const decoder = new TextDecoderStream();
    const stream = new ReadableStream({
      pull(controller) {
        for (let chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }).pipeThrough(decoder);
    for (let reader = stream.getReader(); ; ) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
    }
  }

  // if (new TextDecoder().decode(await runBench(oneKB)) !== src) {
  //   throw new Error("Benchmark failed");
  // }
  const sizes = [16 * 1024, 64 * 1024, 256 * 1024];
  for (const chunkSize of sizes) {
    const text = split(src, chunkSize);
    bench(
      `${Math.round(src.length / 1024)} KB of text in ${Math.round(chunkSize / 1024) > 0 ? Math.round(chunkSize / 1024) : (chunkSize / 1024).toFixed(2)} KB chunks`,
      async () => {
        await runBench(text);
      },
    );
  }
}
create(latin1);
create(
  // bun's old readme was extremely long
  await fetch("https://web.archive.org/web/20230119110956/https://github.com/oven-sh/bun").then(res => res.text()),
);

await run();
