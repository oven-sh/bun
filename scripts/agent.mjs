#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import { join } from "node:path";
import { realpathSync } from "node:fs";
import {
  isWindows,
  getOs,
  getArch,
  getKernel,
  getAbi,
  getAbiVersion,
  getDistro,
  getDistroVersion,
  getHostname,
  getCloud,
  getCloudMetadataTag,
  which,
  getEnv,
  writeFile,
  spawnSafe,
} from "./utils.mjs";
import { parseArgs } from "node:util";

/**
 * @param {"install" | "start"} action
 */
async function doBuildkiteAgent(action) {
  const username = "buildkite-agent";
  const command = which("buildkite-agent", { required: true });

  let homePath, cachePath, logsPath, agentLogPath, pidPath;
  if (isWindows) {
    homePath = "C:\\buildkite-agent";
    cachePath = join(homePath, "cache");
    logsPath = join(homePath, "logs");
    agentLogPath = join(logsPath, "buildkite-agent.log");
  } else {
    homePath = "/var/lib/buildkite-agent";
    cachePath = "/var/cache/buildkite-agent";
    logsPath = "/var/log/buildkite-agent";
    agentLogPath = join(logsPath, "buildkite-agent.log");
    pidPath = join(logsPath, "buildkite-agent.pid");
  }

  async function install() {
    const command = process.execPath;
    const args = [realpathSync(process.argv[1]), "start"];

    if (isWindows) {
      const serviceCommand = [
        "New-Service",
        "-Name",
        "buildkite-agent",
        "-StartupType",
        "Automatic",
        "-BinaryPathName",
        `${escape(command)} ${escape(args.map(escape).join(" "))}`,
      ];
      await spawnSafe(["powershell", "-Command", serviceCommand.join(" ")], { stdio: "inherit" });
    }

    if (isOpenRc()) {
      const servicePath = "/etc/init.d/buildkite-agent";
      const service = `#!/sbin/openrc-run
        name="buildkite-agent"
        description="Buildkite Agent"
        command=${escape(command)}
        command_args=${escape(args.map(escape).join(" "))}
        command_user=${escape(username)}

        pidfile=${escape(pidPath)}
        start_stop_daemon_args=" \
          --background \
          --make-pidfile \
          --stdout ${escape(agentLogPath)} \
          --stderr ${escape(agentLogPath)}"

        depend() {
          need net
          use dns logger
        }
      `;
      writeFile(servicePath, service, { mode: 0o755 });
      writeFile(`/etc/conf.d/buildkite-agent`, `rc_ulimit="-n 262144"`);
      await spawnSafe(["rc-update", "add", "buildkite-agent", "default"], { stdio: "inherit", privileged: true });
    }

    if (isSystemd()) {
      const servicePath = "/etc/systemd/system/buildkite-agent.service";
      const service = `
        [Unit]
        Description=Buildkite Agent
        After=syslog.target
        After=network-online.target

        [Service]
        Type=simple
        User=${username}
        ExecStart=${escape(command)} ${args.map(escape).join(" ")}
        RestartSec=5
        Restart=on-failure
        KillMode=process

        [Journal]
        Storage=persistent
        StateDirectory=${escape(agentLogPath)}

        [Install]
        WantedBy=multi-user.target
      `;
      writeFile(servicePath, service);
      await spawnSafe(["systemctl", "daemon-reload"], { stdio: "inherit", privileged: true });
      await spawnSafe(["systemctl", "enable", "buildkite-agent"], { stdio: "inherit", privileged: true });
    }
  }

  async function start() {
    const cloud = await getCloud();

    let token = getEnv("BUILDKITE_AGENT_TOKEN", false);
    if (!token && cloud) {
      token = await getCloudMetadataTag("buildkite:token");
    }

    let shell;
    if (isWindows) {
      const pwsh = which(["pwsh", "powershell"], { required: true });
      shell = `${pwsh} -Command`;
    } else {
      const sh = which(["bash", "sh"], { required: true });
      shell = `${sh} -c`;
    }

    const flags = ["enable-job-log-tmpfile", "no-feature-reporting"];
    const options = {
      "name": getHostname(),
      "token": token || "xxx",
      "shell": shell,
      "job-log-path": logsPath,
      "build-path": join(homePath, "builds"),
      "hooks-path": join(homePath, "hooks"),
      "plugins-path": join(homePath, "plugins"),
      "experiment": "normalised-upload-paths,resolve-commit-after-checkout,agent-api",
    };

    let ephemeral;
    if (cloud) {
      const jobId = await getCloudMetadataTag("buildkite:job-uuid");
      if (jobId) {
        options["acquire-job"] = jobId;
        flags.push("disconnect-after-job");
        ephemeral = true;
      }
    }

    if (ephemeral) {
      options["git-clone-flags"] = "-v --depth=1";
      options["git-fetch-flags"] = "-v --prune --depth=1";
    } else {
      options["git-mirrors-path"] = join(cachePath, "git");
    }

    const tags = {
      "os": getOs(),
      "arch": getArch(),
      "kernel": getKernel(),
      "abi": getAbi(),
      "abi-version": getAbiVersion(),
      "distro": getDistro(),
      "distro-version": getDistroVersion(),
      "cloud": cloud,
    };

    if (cloud) {
      const requiredTags = ["robobun", "robobun2"];
      for (const tag of requiredTags) {
        const value = await getCloudMetadataTag(tag);
        if (typeof value === "string") {
          tags[tag] = value;
        }
      }
    }

    options["tags"] = Object.entries(tags)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    await spawnSafe(
      [
        command,
        "start",
        ...flags.map(flag => `--${flag}`),
        ...Object.entries(options).map(([key, value]) => `--${key}=${value}`),
      ],
      {
        stdio: "inherit",
      },
    );
  }

  if (action === "install") {
    await install();
  } else if (action === "start") {
    await start();
  }
}

/**
 * @returns {boolean}
 */
function isSystemd() {
  return !!which("systemctl");
}

/**
 * @returns {boolean}
 */
function isOpenRc() {
  return !!which("rc-service");
}

function escape(string) {
  return JSON.stringify(string);
}

async function main() {
  const { positionals: args } = parseArgs({
    allowPositionals: true,
  });

  if (!args.length || args.includes("install")) {
    console.log("Installing agent...");
    await doBuildkiteAgent("install");
    console.log("Agent installed.");
  }

  if (args.includes("start")) {
    console.log("Starting agent...");
    await doBuildkiteAgent("start");
    console.log("Agent started.");
  }
}

await main();
