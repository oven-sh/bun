// What has run on a real Windows machine, as the person who ran it reported it, and what of it a package
// may say about itself: an image and a host are the ones that ran when their bytes are the ones that ran.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Run {
  /** sha256 of the image that ran. */
  image: string;
  /** What was seen, in the order of the steps of commands.txt. */
  results: string[];
}

export const RAN_ON_WINDOWS = {
  date: "2026-09-27",
  machine: "Windows x64",
  /** The tree that the two packages were made from. */
  commit: "8c36d1a5e5",
  with: "clang 23.1.1, libuv 8023581113 with bun's two patches, everything built on that machine with the commands below",
  /** sha256 of the sources of the host that was built there. */
  host: {
    "host_win.c": "af2388039634ae812ad1e84ac95f0c2c5d15197578df62d6fb4e5fcc92c0d957",
    "host_win_uv.c": "ed7089b45895994031c37a39d586e8cb1c4eb32886198db8f7152d454600d51e",
    "linux_abi.h": "a8550af833dad6ffcd65af7b0806ff29a2107a84cb2b426d6cf17146f8ec2ce0",
    "memory.h": "aabb440df492488dac55edf9b77bfff2e37b8205671d68d87b71b3babcfe7de4",
  } as Record<string, string>,
  files: {
    image: "5c78ce0662bfd8f92cb6774becf2137afaf15743b58c3b37d056177aaf05708d",
    results: [
      "libuv: 37 of 37 objects, the host linked, no message of the compiler",
      "imports: total 246, missing 0",
      "the slice: exit code 0, 51 lines",
      'compare-run.ts: "host win32: 49 steps as on Linux, 2 accepted differences, 0 unexpected"',
    ],
  } as Run,
  loop: {
    image: "bf33539ec657f963923d1cf96427631d51d91f9da4686976c0135528b632be76",
    results: [
      "libuv: 37 of 37 objects, the host linked, no message of the compiler",
      "check_on_windows.c and check_on_windows.cpp: exit code 0, no line of output",
      "imports: total 293, missing 0",
      "the slice: exit code 0, 8 lines, every step ok (host, timer, tcp echo, tcp echo large, thread pool, child with three pipes, child that is killed, timer of uSockets)",
      'compare-run.ts: "host win32: 5 steps as on Linux, 3 accepted differences, 0 unexpected"',
    ],
  } as Run,
  notRun: "Windows arm64: not run, the package has no image for arm64.",
};

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * The paragraph of commands.txt about what has run on Windows, for the package of `slice` with the image
 * at `image` and the sources of the host in `hostDirectory`. `indent` is in front of every line.
 */
export function whatRanOnWindows(slice: "files" | "loop", image: string, hostDirectory: string, indent: string) {
  const ran = RAN_ON_WINDOWS[slice];
  const sameImage = sha256(image) === ran.image;
  const changed = Object.entries(RAN_ON_WINDOWS.host)
    .filter(([name, hash]) => sha256(join(hostDirectory, name)) !== hash)
    .map(([name]) => name);
  const what =
    sameImage && changed.length === 0
      ? "THIS image and THIS host ran"
      : `The image with sha256 ${ran.image} and the host of commit ${RAN_ON_WINDOWS.commit} ran`;
  const lines = [
    `${what} on ${RAN_ON_WINDOWS.machine} on ${RAN_ON_WINDOWS.date}: a person did the steps below there`,
    `(${RAN_ON_WINDOWS.with}).`,
    ...ran.results.map(result => `  - ${result}`),
    RAN_ON_WINDOWS.notRun,
  ];
  if (!sameImage) lines.push("THIS image is another build than the one that ran: it has not run on Windows.");
  if (changed.length > 0)
    lines.push(`THIS host has other sources than the one that ran (${changed.join(", ")}): it has not run on Windows.`);
  return lines.map(line => indent + line).join("\n");
}
