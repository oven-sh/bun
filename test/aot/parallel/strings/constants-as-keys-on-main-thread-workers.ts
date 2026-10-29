// Texts of which the program only makes strings: used as keys of maps, sets and objects, compared with strings made at run time, handed to native code,
// on the main thread and in Workers, and read on the main thread after the Worker that made them has ended.
declare var self: Worker;

function colors(): string[] {
  return ["crimson lake", "burnt umber", "viridian green", "cobalt blue", "naples yellow", "ivory black", "“quoted” — wide", "λ calculus", "ab", "a longer text that no other part of this program names or compares with anything"];
}

function color(index: number): string {
  return colors()[index] ?? "";
}

function first(): string {
  return "a text made in a function that runs many times";
}

function checksum(text: string): number {
  let sum = 0;
  for (let index = 0; index < text.length; index++) sum = (sum * 33 + text.charCodeAt(index)) % 1000003;
  return sum;
}

function work(tag: string): string[] {
  const lines: string[] = [];
  const byText = new Map<string, number>();
  const seen = new Set<string>();
  const asKeys: Record<string, number> = {};
  for (let round = 0; round < 3; round++) {
    for (const [index, text] of colors().entries()) {
      byText.set(text, (byText.get(text) ?? 0) + index);
      seen.add(text);
      asKeys[text] = (asKeys[text] ?? 0) + 1;
    }
  }
  lines.push(tag + " sizes " + byText.size + " " + seen.size + " " + Object.keys(asKeys).length);
  // The same texts out of pieces: other strings with the same characters.
  for (const text of colors()) {
    const copy = text.split("").join("");
    lines.push([tag, checksum(text), byText.get(copy), seen.has(copy), asKeys[copy], copy === text, text.localeCompare(copy), Buffer.byteLength(text)].join(" "));
  }
  lines.push(tag + " " + (first() === first()) + " " + (first() + "" === first()) + " " + first().length + " " + JSON.stringify({ [first()]: first() }).length);
  lines.push(tag + " " + Bun.hash.crc32(first()) + " " + encodeURIComponent(color(6)) + " " + color(7).normalize("NFD").length + " " + Bun.stringWidth(color(6)));
  Bun.gc(true);
  lines.push(tag + " " + colors().map(checksum).join());
  return lines;
}

if (Bun.isMainThread) {
  const mine = work("main");
  const kept: { texts: string[]; lines: string[]; table: Record<string, string> }[] = [];
  for (const tag of ["one", "two"]) {
    const worker = new Worker(import.meta.url);
    const answer = await new Promise<any>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(tag);
    });
    await worker.terminate();
    kept.push(answer);
  }
  Bun.gc(true);
  for (const line of mine) console.log(line);
  for (const answer of kept) {
    for (const line of answer.lines) console.log(line);
    console.log(answer.texts.map(checksum).join(), answer.texts.every((text, index) => text === colors()[index]), Object.keys(answer.table).length, answer.table[first()] === first());
  }
} else {
  self.onmessage = (event: MessageEvent) => {
    postMessage({ texts: colors(), lines: work(event.data), table: { [first()]: first(), [color(0)]: color(1) } });
  };
}
