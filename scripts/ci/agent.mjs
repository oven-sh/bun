#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import { join } from "node:path";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
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
  spawnSyncSafe,
  writeFile,
  spawnSafe,
} from "../utils.mjs";
import { parseArgs } from "node:util";

/**
 * @param {"install" | "start"} action
 */
export async function doAgent(action) {
  const username = "buildkite-agent";
  const command = which("buildkite-agent") || "buildkite-agent";

  /**
   * @param {...string} args
   * @returns {string}
   */
  function getPath(...args) {
    const lastArg = args.at(-1);
    const options = typeof lastArg === "object" ? lastArg : undefined;
    const paths = options ? args.slice(0, -1) : args;
    const path = join(...paths);

    if (action === "install") {
      if (options?.["mkdir"]) {
        mkdirSync(path, { recursive: true });
      } else if (options?.["touch"]) {
        appendFileSync(path, "");
      }
      spawnSyncSafe(["chown", "-R", `${username}:${username}`, path]);
    }

    return path;
  }

  let homePath, cachePath, logsPath, agentLogPath, pidPath;
  if (isWindows) {
    throw new Error("TODO: Windows");
  } else {
    const varPath = join("/", "var");
    homePath = getPath(varPath, "lib", "buildkite-agent", { mkdir: true });
    cachePath = getPath(varPath, "cache", "buildkite-agent", { mkdir: true });
    logsPath = getPath(varPath, "log", "buildkite-agent", { mkdir: true });
    agentLogPath = getPath(logsPath, "buildkite-agent.log", { touch: true });
    pidPath = getPath(varPath, "run", "buildkite-agent.pid", { touch: true });
  }

  function escape(string) {
    return JSON.stringify(string);
  }

  async function install() {
    const command = process.execPath;
    const args = [realpathSync(process.argv[1]), "start"];

    if (isOpenRc()) {
      const servicePath = join("/", "etc", "init.d", "buildkite-agent");
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
      await spawnSafe(["rc-update", "add", "buildkite-agent", "default"]);
    }

    if (isSystemd()) {
      const servicePath = join("/", "etc", "systemd", "system", "buildkite-agent.service");
      const service = `
        [Unit]
        Description=Buildkite Agent
        After=syslog.target
        After=network-online.target
      
        [Service]
        Type=simple
        User=${username}
        ExecStart=${escape(command)} ${escape(args.map(escape).join(" "))}
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
      await spawnSafe(["systemctl", "daemon-reload"]);
      await spawnSafe(["systemctl", "enable", "buildkite-agent"]);
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
      "git-mirrors-path": join(cachePath, "git"),
      "build-path": join(homePath, "builds"),
      "hooks-path": join(homePath, "hooks"),
      "plugins-path": join(homePath, "plugins"),
      "experiment": "normalised-upload-paths,resolve-commit-after-checkout,agent-api",
    };

    if (cloud) {
      const jobId = await getCloudMetadataTag("buildkite:job-uuid");
      if (jobId) {
        options["acquire-job"] = jobId;
        flags.push("disconnect-after-job");
      }
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
      const robobun = await getCloudMetadataTag("robobun");
      if (robobun === "true") {
        tags["robobun"] = "true";
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
export function isSystemd() {
  return !!which("systemctl");
}

/**
 * @returns {boolean}
 */
export function isOpenRc() {
  return !!which("rc-service");
}

export async function main() {
  const { positionals: args } = parseArgs({
    allowPositionals: true,
  });

  if (!args.length || args.includes("install")) {
    console.log("Installing agent...");
    await doAgent("install");
    console.log("Agent installed.");
  }

  if (args.includes("start")) {
    console.log("Starting agent...");
    await doAgent("start");
    console.log("Agent started.");
  }
}

await main();
