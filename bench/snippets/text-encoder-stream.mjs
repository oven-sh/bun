import { bench, run } from "./runner.mjs";

const latin1 = `hello hello hello!!!!`.repeat(102400).split("").join("");

function create(src) {
  function split(str, chunkSize) {
    let chunkedHTML = [];
    let html = str;
    while (html.length > 0) {
      chunkedHTML.push(html.slice(0, chunkSize).split("").join(""));
      html = html.slice(chunkSize);
    }
    return chunkedHTML;
  }

  const quarterKB = split(src, 256);
  const oneKB = split(src, 1024);
  const fourKB = split(src, 4096);
  const sixteenKB = split(src, 16 * 1024);

  async function runBench(chunks) {
    const encoderStream = new TextEncoderStream();
    const stream = new ReadableStream({
      pull(controller) {
        for (let chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }).pipeThrough(encoderStream);
    for (let reader = stream.getReader(); ; ) {
      const { value, done } = await reader.read();
      if (done) break;
    }
  }

  // if (new TextDecoder().decode(await runBench(oneKB)) !== src) {
  //   throw new Error("Benchmark failed");
  // }

  bench(`${(src.length / 1024) | 0} KB of HTML in 0.25 KB chunks`, async () => {
    await runBench(quarterKB);
  });

  bench(`${(src.length / 1024) | 0} KB of HTML in 1 KB chunks`, async () => {
    await runBench(oneKB);
  });

  bench(`${(src.length / 1024) | 0} KB of HTML in 4 KB chunks`, async () => {
    await runBench(fourKB);
  });

  bench(`${(src.length / 1024) | 0} KB of HTML in 16 KB chunks`, async () => {
    await runBench(sixteenKB);
  });
}

create(latin1);
create(await fetch("https://bun.sh").then(res => res.text()));

await run();
