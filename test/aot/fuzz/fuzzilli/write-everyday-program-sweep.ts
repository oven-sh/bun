// Writes the everyday programs of ../../harness/everyday-program-cases.ts out as files: the kind of loop, times the kind of loop inside it, times what the function makes in front of the loop, times where the
// list comes from, times what the body does, times the kind of file. Each program holds one of each and is built alone.
//
//   bun write-everyday-program-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loop>--<inner>--<front>--<source>--<body>--<file>.js or .ts
//   bun write-everyday-program-sweep.ts count
//   bun write-everyday-program-sweep.ts named <pattern> <folder> [most]
import { mkdirSync, writeFileSync } from "fs";
import { everydayProgram as write, everydayProgramCount as all } from "../../harness/everyday-program-cases";

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
