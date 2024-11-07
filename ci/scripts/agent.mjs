#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import {
  getOs,
  getArch,
  getAbi,
  getDistro,
  getDistroRelease,
  getKernel,
  getHostname,
  getCloud,
} from "../../scripts/utils.mjs";

/**
 * @returns {Promise<Record<string, string>>}
 */
async function getTags() {
  const tags = {
    os: getOs(),
    arch: getArch(),
    kernel: getKernel(),
    abi: getAbi(),
    distro: getDistro(),
    release: getDistroRelease(),
    hostname: getHostname(),
    cloud: await getCloud(),
  };

  return Object.fromEntries(Object.entries(tags).filter(([, value]) => value));
}

/**
 * @param {string} name
 * @returns {Promise<string | undefined>}
 */
async function getMetadata(name) {}

console.log(await getTags());
