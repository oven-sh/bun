// What the places of reads remember lies in one room of 512 KB below the instance: narrow records of 16 bytes grow up from its beginning, wide ones of 64 bytes down from its end.
// A place gets a wide record when objects of a second kind that lack the name come to it. This program has four more such places than wide records fit into the room, each warmed on its own,
// then eight places of other names, which want narrow records where two are left. A place that comes too late goes without, and every read answers as ever.
// Once the room for one more wide record was asked of a difference that wrapped below zero: the record behind the last lay in front of the room, and two places of two names read one record.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const places = (512 * 1024) / 64 + 4;
// Neighbors share the count that makes a place wait between two fills, and the longest wait is 4,095 misses.
const program = `
const readers = [${"o => o.signal, ".repeat(places)}o => o.b, o => o.c, o => o.d, o => o.e, o => o.f, o => o.g, o => o.h, o => o.i];
console.log(new Function("readers", \`
    const bare = count => { const made = Object.create(null); for (let at = 0; at < count; at++) made["abcdefghi"[at]] = 7 + at; return made; };
    const one = bare(1), two = bare(2), three = bare(9);
    let missing = 0, sum = 0, found = 0;
    for (let at = 0; at < ${places}; at++) {
        const read = readers[at];
        for (let turn = 0; turn < 800; turn++) if (read(one) === undefined) missing++;
        for (let turn = 0; turn < 4400; turn++) if (read(two) === undefined) missing++;
    }
    for (let late = ${places}; late < ${places + 8}; late++) for (let turn = 0; turn < 800; turn++) sum += readers[late](three);
    for (let at = 0; at < ${places}; at++) for (const object of [one, two, three]) if (readers[at](object) !== undefined) found++;
    return missing + " " + sum + " " + found;
\`)(readers));
`;

test("each read answers rightly", async () => {
  using directory = tempDir("aot-room-of-answers", { "main.js": program });
  const folder = String(directory);
  const executable = join(folder, "main");
  expect(
    await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], folder),
  ).toMatchObject({ exitCode: 0 });
  expect(await run([executable], folder)).toMatchObject({
    stdout: `${places * 5200} ${800 * (8 + 9 + 10 + 11 + 12 + 13 + 14 + 15)} 0\n`,
    exitCode: 0,
  });
}, 240_000);
