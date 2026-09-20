import type { Tool } from "../image.ts";

/**
 * Google Chrome for the browser tests. Google only publishes "stable" for
 * amd64 on apt, so that is the one image kind this applies to; the others use
 * the distro's chromium or run without one.
 */
export function chrome(): Tool {
  const url = "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb";
  return { name: "chrome", script: "linux/chrome.sh", variables: { CHROME_DEB_URL: url } };
}
