// Browsers for puppeteer-based tests: the distro's Chromium runtime deps
// (every linux image), and Google Chrome from its .deb (the x64 apt images
// that list `chrome`) so tests with a system browser skip their per-run
// Chrome-for-Testing download.

import { shellScript } from "../bootstrap/ops-posix.ts";
import { download, warn } from "../bootstrap/runtime.ts";
import type { LinuxComponent } from "./component.ts";
import { artifact } from "./component.ts";

/** Chromium runtime dependencies for puppeteer-based tests. */
export const chromium: LinuxComponent = {
  name: "chromium",
  artifacts: () => ({}),
  steps: ctx => [
    {
      name: "Install Chromium test dependencies",
      run: () => ctx.manager.install(ctx, ctx.image.packages.chromium),
    },
  ],
};

/** Google Chrome itself, from its .deb (an apt package). Listed only on the
 * x64 apt images, whose entry carries `chromeDebUrl`. */
export const chrome: LinuxComponent = {
  name: "chrome",
  artifacts: image => {
    const url = image.arch === "x64" ? image.chromeDebUrl : null;
    if (!url) throw new Error(`${image.key} lists "chrome" but has no chromeDebUrl`);
    return { chromeDeb: { url, sha256: null } };
  },
  steps: ctx => [
    {
      name: "Install Google Chrome (system browser skips per-run Chrome-for-Testing download)",
      run: async () => {
        // Best-effort: a Chrome install hiccup shouldn't fail the bake.
        const deb = await download(artifact(ctx.artifacts, "chromeDeb"), { name: "google-chrome.deb" });
        const result = await shellScript({
          describe: "install the Chrome .deb, letting apt resolve deps and falling back to dpkg",
          root: true,
          allowFailure: true,
          script: `apt-get install -y '${deb}' || dpkg -i '${deb}'`,
        });
        if (result.exitCode !== 0) warn("Chrome install failed; puppeteer tests will download their own browser");
      },
    },
  ],
};
