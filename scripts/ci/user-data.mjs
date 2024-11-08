#!/usr/bin/env node

// A script that generates a user-data script to setup a CI machine.
// It includes the following:

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { curlSafe, spawnSafe } from "../utils.mjs";

/**
 * @typedef {object} UserData
 * @property {"darwin" | "linux" | "windows"} os
 * @property {"x64" | "aarch64"} [arch]
 * @property {string} [distro]
 * @property {string} [release]
 * @property {string} [username]
 * @property {string} [password]
 * @property {string[]} [authorizedKeys]
 */

/**
 * @param {UserData} userData
 * @returns {Promise<string>}
 */
export async function getUserData(userData) {
  if (userData["os"] === "linux") {
    return getCloudInit(userData);
  }
}

/**
 * @param {UserData} userData
 * @returns {Promise<string>}
 */
export async function getCloudInit(userData) {
  if (userData["os"] !== "linux") {
    throw new Error(`Unsupported operating system: ${userData["os"]}`);
  }

  const username = userData["username"] || "root";
  const password = userData["password"] || crypto.randomUUID();
  const authorizedKeys = userData["authorizedKeys"] || getAuthorizedKeys();
  const bootstrapScript = getBootrapScript(userData["os"]);
  const agentScript = await getAgentScript();
  const [bootstrapUrl, agentUrl] = await Promise.all([uploadTmpFile(bootstrapScript), uploadTmpFile(agentScript)]);

  // https://cloudinit.readthedocs.io/en/stable/
  return `#cloud-config

    package_update: true
    packages:
      - curl
      - ca-certificates
      - openssh-server
    
    write_files:
      - path: /etc/ssh/sshd_config
        content: |
          PermitRootLogin yes
          PasswordAuthentication yes
      - path: /tmp/agent.sh
        permissions: "0755"
        content: |
          node /tmp/agent.mjs 2>&1 | tee /tmp/agent.log
      - path: /tmp/bootstrap.sh
        permissions: "0755"
        content: |
          # Most cloud platforms have limits on the size of the user-data script.
          # To work around this, we upload the bootstrap script to a temporary URL
          # then download and replace it at boot time.
          curl -fsSL "${bootstrapUrl}" -o /tmp/bootstrap.sh
          chmod +x /tmp/bootstrap.sh
          curl -fsSL "${agentUrl}" -o /tmp/agent.mjs
          chmod +x /tmp/agent.mjs
          export CI=true
          sh /tmp/bootstrap.sh 2>&1 | tee /tmp/bootstrap.log

    runcmd:
      - [cloud-init-per, once, bootstrap, sh, /tmp/bootstrap.sh]
      - [sh, -c, "/tmp/agent.sh &"]

    chpasswd:
      expire: false
      list: |
        root:${password}
        ${username}:${password}

    disable_root: false

    ssh_pwauth: true
    ssh_authorized_keys: [${authorizedKeys.map(key => JSON.stringify(key)).join(", ")}]
  `;
}

/**
 * @param {string} content
 */
export async function uploadTmpFile(content) {
  const body = new FormData();
  body.append("file", new Blob([content]), "file");

  const { success, link } = await curlSafe("https://file.io/?expires=1h&autoDelete=true&maxDownloads=1", {
    method: "POST",
    body,
    json: true,
  });
  if (!success) {
    throw new Error(`Failed to upload file: ${link}`);
  }

  return new URL(link).toString();
}

/**
 * @param {"darwin" | "linux" | "windows"} os
 */
export function getBootrapScript(os) {
  if (os === "windows") {
    throw new Error(`Unsupported operating system: ${os}`);
  }

  const scriptPath = resolve(import.meta.dirname, "..", "..", "scripts", "bootstrap.sh");
  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  return readFileSync(scriptPath, "utf8");
}

/**
 * @returns {Promise<string>}
 */
export async function getAgentScript() {
  const scriptPath = resolve(import.meta.dirname, "agent.mjs");
  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const { stdout } = await spawnSafe(["bunx", "esbuild", "--platform=node", "--format=esm", "--bundle", scriptPath]);
  return stdout;
}

/**
 * @returns {string[]}
 */
export function getAuthorizedKeys() {
  const homePath = homedir();
  const sshPath = join(homePath, ".ssh");

  if (existsSync(sshPath)) {
    const sshFiles = readdirSync(sshPath, { withFileTypes: true });
    const sshPaths = sshFiles
      .filter(entry => entry.isFile() && entry.name.endsWith(".pub"))
      .map(({ name }) => join(sshPath, name));

    return sshPaths
      .map(path => readFileSync(path, "utf8"))
      .map(key => key.split(" ").slice(0, 2).join(" "))
      .filter(key => key.length);
  }

  return [];
}

/**
 * @param {string} organization
 * @returns {Promise<string[]>}
 */
export async function getGithubAuthorizedKeys(organization) {
  const members = await curlSafe(`https://api.github.com/orgs/${organization}/members`, { json: true });
  const sshKeys = await Promise.all(
    members.map(async ({ login }) => {
      const publicKeys = await curlSafe(`https://github.com/${login}.keys`);
      return publicKeys
        .split("\n")
        .map(key => key.trim())
        .filter(key => key.length);
    }),
  );

  return sshKeys.flat();
}
