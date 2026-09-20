import type { Tool } from "../image.ts";

/** Its version is whatever Tailscale's installer serves on the day of the bake. */
export function tailscale(): Tool {
  const url = "https://tailscale.com/install.sh";
  return { name: "tailscale", script: "linux/tailscale.sh", variables: { TAILSCALE_INSTALL_URL: url } };
}
