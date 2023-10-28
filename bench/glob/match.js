import { run, bench, group } from "mitata";
import fg from "fast-glob";
import { Glob } from "bun";

const bunGlob = new Glob("*.zig");

// (async () => {
//   const entries = await bunGlob.match({
//     cwd: "/Users/zackradisic/Code/bun/src",
//   });
// })();

// (async () => {
//   const entries = await bunGlob.match({
//     cwd: "/Users/zackradisic/Code/bun/src",
//   });
// })();

let bunCount = 0;

group({ name: "async", summary: true }, () => {
  bench("fast-glob", async () => {
    const entries = await fg.glob(["*.zig"], {
      cwd: "/Users/zackradisic/Code/bun/src",
    });
  });

  bench("Bun.Glob", async () => {
    // const entries = await new Glob("*.zig").match({
    //   cwd: "/Users/zackradisic/Code/bun/src",
    // });
    const entries = await bunGlob.match({
      cwd: "/Users/zackradisic/Code/bun/src",
    });
    console.log("Bun", bunCount++);
  });
});

// group({ name: "sync", summary: true }, () => {
//   bench("fast-glob", () => {
//     const entries = fg.globSync(["*.zig"], {
//       cwd: "/Users/zackradisic/Code/bun/src",
//     });
//   });

//   bench("Bun.Glob", () => {
//     // const entries = new Glob("*.zig").matchSync({
//     //   cwd: "/Users/zackradisic/Code/bun/src",
//     // });
//     const entries = bunGlob.matchSync({
//       cwd: "/Users/zackradisic/Code/bun/src",
//     });
//   });
// });

await run({
  avg: true,
  colors: true,
  min_max: true,
  collect: true,
  percentiles: true,
});
