import type { LinuxImage, Tool } from "../image.ts";

/** Docker, for the tests that talk to real databases. Its version is whatever the day of the bake serves. */
export function docker(image: LinuxImage): Tool {
  if (image.distro === "alpine") {
    return { name: "docker", script: "linux/docker.apk.sh", variables: {} };
  }
  const url = "https://get.docker.com";
  return { name: "docker", script: "linux/docker.sh", variables: { DOCKER_INSTALL_URL: url } };
}
