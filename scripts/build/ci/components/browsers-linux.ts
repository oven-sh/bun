// Browsers for puppeteer-based tests: the distro's Chromium runtime deps,
// plus Google Chrome itself where a .deb exists (x64 apt images) so tests
// with a system browser skip their per-run Chrome-for-Testing download.

import { shellScript } from "../bootstrap/ops-posix.ts";
import { download, warn } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { artifact } from "./component.ts";
import type { LinuxImage } from "../types.ts";
import { installPackages } from "./system-linux.ts";

/**
 * The single predicate for "this image gets Google Chrome (a .deb)": an
 * x64 image with a chrome .deb URL. Both the artifact declaration and the
 * step gate use it, so they can never disagree (a truthy check and a
 * !== null check diverge on an empty string).
 */
function hasChromeDeb(image: LinuxImage): image is LinuxImage & { chromeDebUrl: string } {
  return image.arch === "x64" && !!image.chromeDebUrl;
}

/** Chromium runtime for puppeteer-based tests (+ Chrome itself on x64). */
export const chromium: Component = {
  name: "chromium",
  linux: {
    artifacts: image =>
      hasChromeDeb(image) ? { chromeDeb: { url: image.chromeDebUrl, sha256: null } } : {},
    steps: ctx => {
      const { image } = ctx;
      const chromeDeb = hasChromeDeb(image);
      return [
        {
          name: "Install Chromium test dependencies",
          run: () => installPackages(ctx, image.packages.chromium),
        },
        {
          name: "Install Google Chrome (system browser skips per-run Chrome-for-Testing download)",
          skip: !chromeDeb && "no Chrome .deb build for this image (x64 apt only)",
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
      ];
    },
  },
};
