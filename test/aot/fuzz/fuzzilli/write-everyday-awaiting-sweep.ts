// Writes the everyday programs of ../../harness/everyday-awaiting-program-cases.ts out as files: how an async function walks a list of records, times what is awaited, times what is taken in front of the await and used
// behind it, times how the walk is left early, times where the rows come from, times the kind of file. Each program holds one of each and is built alone.
//
//   bun write-everyday-awaiting-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<walk>--<awaited>--<kept>--<exit>--<source>--<file>.mjs or .ts
//   bun write-everyday-awaiting-sweep.ts count
//   bun write-everyday-awaiting-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";
import {
  everydayAwaitingProgram as write,
  everydayAwaitingProgramCount as all,
} from "../../harness/everyday-awaiting-program-cases";

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laidOut = 0;
  for (let at = 0; at < all && laidOut < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laidOut++;
  }
  console.log(laidOut);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
