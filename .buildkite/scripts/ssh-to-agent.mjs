#!/usr/bin/env node
// Script to SSH into multiple agents and run a command.

import { spawnSync } from "node:child_process";

const orgId = process.env.BUILDKITE_ORG || "bun";
const accessToken = process.env.BUILDKITE_TOKEN;
const tags = process.argv
  .slice(2)
  .filter(arg => /^--.*=.*$/i.test(arg))
  .map(arg => arg.replace(/^--/, ""));
const sshArgs = process.argv.slice(2).filter(arg => /^-i/i.test(arg));
const sshCommand = process.argv.includes("--") ? ["-t", ...process.argv.slice(process.argv.indexOf("--"))] : [];

const agents = [];
for (let page = 1; ; page++) {
  const response = await fetch(`https://api.buildkite.com/v2/organizations/${orgId}/agents?page=${page}&per_page=100`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const { ok, status, statusText } = response;
  if (!ok) {
    throw new Error(`Failed to fetch agents: ${status} ${statusText}`, {
      cause: await response.text(),
    });
  }

  const results = await response.json();
  if (!results.length) {
    break;
  }
  agents.push(...results);
}
console.log("Found", agents.length, "agents");

const machines = [...new Map(agents.map(agent => [agent.ip_address, agent])).values()];
const filteredMachines = machines.filter(({ meta_data: metaData }) => tags.every(tag => metaData.includes(tag)));
if (tags.length) {
  console.log("Found", filteredMachines.length, "machines with tags:", tags);
} else {
  console.log("Found", machines.length, "machines");
}

for (let i = 0; i < filteredMachines.length; i++) {
  const machine = filteredMachines[i];
  const { name, ip_address: address } = machine;
  console.log("Connecting to", address, name, "[", i + 1, "/", filteredMachines.length, "]");

  for (const username of getUsers(name)) {
    const target = `${username}@${address}`;
    const { status } = spawnSync("ssh", ["-oBatchMode=yes", ...sshArgs, target, ...sshCommand], {
      stdio: "inherit",
      shell: process.env.SHELL || true,
    });
    if (status !== 255) {
      break;
    }
  }
}

function getUsers(name) {
  if (/darwin/i.test(name)) {
    return ["administrator", "ec2-user"];
  }
  if (/linux/i.test(name)) {
    return ["admin", "ec2-user", "root"];
  }
  return ["administrator", "admin", "ec2-user", "root"];
}
