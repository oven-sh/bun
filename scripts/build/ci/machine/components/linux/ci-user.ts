// The buildkite-agent user, its home, state dirs, and hooks (linux CI images).
// Sequenced BEFORE nodejs's gyp-cache step and prefetch, which write into
// this user's home.

import { ensureDirectory, ensureSystemUser, setOwnerRecursive } from "../../ops-posix.ts";
import { writeText } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { agentHome } from "../paths.ts";

export const ciUser: LinuxComponent = {
  name: "ci-user",
  artifacts: () => ({}),
  steps: ctx => {
    const { image, ci, manager } = ctx;
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
            flavor: manager.userFlavor,
          });
          // Docker group membership is granted by the docker component,
          // which runs AFTER this and creates the group; adding here would
          // no-op against a group that doesn't exist yet.
          for (const dir of [home, ...image.paths.buildkiteDirs]) {
            await ensureDirectory(dir, { owner: `${user}:${user}` });
          }
          // Checkout/work dir from the spec fact (paths.workDir) — stable
          // so ccache is effective across jobs.
          const hooksDir = `${home}/hooks`;
          await ensureDirectory(hooksDir, { mode: "755" });
          await writeText(
            `${hooksDir}/environment`,
            `#!/bin/sh\nset -efu\n\nexport BUILDKITE_BUILD_CHECKOUT_PATH=${image.paths.workDir}\n`,
            {
              mode: 0o755,
            },
          );
          await setOwnerRecursive(hooksDir, `${user}:${user}`);
        },
      },
    ];
  },
};
