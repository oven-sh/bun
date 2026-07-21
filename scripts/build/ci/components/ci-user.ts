// The buildkite-agent user, its home, state dirs, and hooks (linux CI images).
// Sequenced BEFORE nodejs's gyp-cache step and prefetch, which write into
// this user's home.

import { ensureDirectory, ensureSystemUser, setOwnerRecursive } from "../bootstrap/ops-posix.ts";
import { writeText } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { agentHome } from "./paths.ts";

export const ciUser: Component = {
  name: "ci-user",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image, ci } = ctx;
      return [
        {
          name: "Create buildkite-agent user, dirs, and hooks",
          skip: !ci && "not a CI image",
          run: async () => {
            const user = image.paths.buildkiteUser;
            const home = agentHome(image);
            await ensureSystemUser({
              name: user,
              home,
              shell: "/bin/sh",
              flavor: image.distro === "alpine" ? "busybox" : "shadow",
            });
            // Docker group membership is granted by the docker component,
            // which runs AFTER this and creates the group; adding here would
            // no-op against a group that doesn't exist yet.
            for (const dir of [home, ...image.paths.buildkiteDirs]) {
              await ensureDirectory(dir, { owner: `${user}:${user}` });
            }
            // Stable checkout directory so ccache is effective across jobs.
            const hooksDir = `${home}/hooks`;
            await ensureDirectory(hooksDir, { mode: "755" });
            await writeText(
              `${hooksDir}/environment`,
              `#!/bin/sh\nset -efu\n\nexport BUILDKITE_BUILD_CHECKOUT_PATH=${home}/build\n`,
              {
                mode: 0o755,
              },
            );
            await setOwnerRecursive(hooksDir, `${user}:${user}`);
          },
        },
      ];
    },
  },
};
