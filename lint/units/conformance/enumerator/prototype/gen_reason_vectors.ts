// Inputs for the ground truth of the skip rule: the full product of the values each field can take.
const modules = [0, 1, 2, 3, 4, 5, 6, 7, 99, 100, 101, 102, 199, 200];
const resolutions = [0, 1, 2, 3, 99, 100];
const tri = [0, 1, 2];
const targets = [0, 1, 2, 9, 99];
const paths = ["", "/.src", "c:/root"];
const out: string[] = [];
for (const m of modules) for (const r of resolutions) for (const e of tri) for (const a of tri) for (const t of targets) for (const s of tri) for (const b of paths) for (const o of paths) {
  out.push([m, r, e, a, t, s, b, o].join("\t"));
}
await Bun.write(process.argv[2], out.join("\n") + "\n");
console.log(out.length);
