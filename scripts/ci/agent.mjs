#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import { join } from "node:path";
import { appendFileSync, chownSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
  writeFile,
  spawnSafe,
  which,
  getUser,
} from "../utils.mjs";

/**
 * @param {string} token
 * @returns {Promise<Service>}
 */
export async function getAgentService(token) {
  const command = which("buildkite-agent", { required: true });
  const { username, uid, gid } = await getUser("buildkite-agent");

  let shell;
  if (isWindows) {
    const pwsh = which(["pwsh", "powershell"], { required: true });
    shell = `${pwsh} -Command`;
  } else {
    const sh = which(["bash", "sh"], { required: true });
    shell = `${sh} -c`;
  }

  let homePath, cachePath, logsPath, agentLogPath, socketPath, pidPath;
  if (isWindows) {
    throw new Error("TODO: Windows");
  } else {
    const varPath = join("/", "var");
    homePath = getPath(varPath, "lib", "buildkite-agent", { uid, gid, mkdir: true });
    cachePath = getPath(varPath, "cache", "buildkite-agent", { uid, gid, mkdir: true });
    logsPath = getPath(varPath, "log", "buildkite-agent", { uid, gid, mkdir: true });
    agentLogPath = getPath(logsPath, "buildkite-agent.log", { uid, gid, touch: true });
    socketPath = getPath(varPath, "run", "buildkite-agent.sock", { uid, gid, mkdir: true });
    pidPath = getPath(varPath, "run", "buildkite-agent.pid", { uid, gid, touch: true });
  }

  const flags = ["enable-job-log-tmpfile", "no-feature-reporting"];
  const options = {
    "name": getHostname(),
    "token": token,
    "shell": shell,
    "sockets-path": socketPath,
    "job-log-path": logsPath,
    "git-mirrors-path": join(cachePath, "git"),
    "build-path": join(homePath, "builds"),
    "hooks-path": join(homePath, "hooks"),
    "plugins-path": join(homePath, "plugins"),
    "experiment": "normalised-upload-paths,resolve-commit-after-checkout,agent-api",
  };

  let oneShot;
  const cloud = await getCloud();
  if (cloud) {
    const jobId = await getCloudMetadataTag("buildkite:job-uuid");
    if (jobId) {
      options["acquire-job"] = jobId;
      flags.push("disconnect-after-job");
      oneShot = true;
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

  options["tags"] = Object.entries(tags)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  const args = [
    "start",
    ...flags.map(flag => `--${flag}`),
    ...Object.entries(options).map(([key, value]) => `--${key}=${value}`),
  ];

  if (isSystemd()) {
    const service = `
      [Unit]
      Description=Buildkite Agent
      Documentation=https://buildkite.com/docs/agent/v3/configuration
      After=syslog.target
      After=network-online.target
    
      [Service]
      Type=${oneShot ? "oneshot" : "simple"}
      User=${username}
      Environment=HOME=${homePath}
      ExecStart=${command} ${args.map(arg => JSON.stringify(arg)).join(" ")}
      RestartSec=5
      Restart=on-failure
      KillMode=process

      [Journal]
      Storage=persistent
      StateDirectory=${agentLogPath}
    
      [Install]
      WantedBy=multi-user.target
    `;
    return getSystemdService("buildkite-agent", service);
  }

  if (isOpenRc()) {
    const service = `#!/sbin/openrc-run
      name="buildkite-agent"
      description="Buildkite Agent"
      command=${JSON.stringify(command)}
      command_args=${JSON.stringify(args.map(arg => JSON.stringify(arg)).join(" "))}
      command_user=${JSON.stringify(username)}

      pidfile=${JSON.stringify(pidPath)}
      start_stop_daemon_args=" \
        --background \
        --make-pidfile \
        --stdout ${agentLogPath} \
        --stderr ${agentLogPath}"

      depend() {
        need net
        use dns logger
      }
    `;
    return getOpenRcService("buildkite-agent", service);
  }

  throw new Error(`Unsupported service manager: ${getOs()}`);
}

/**
 * @typedef {object} Service
 * @property {string} name
 * @property {() => Promise<void>} install
 * @property {() => Promise<void>} enable
 * @property {() => Promise<void>} disable
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {() => Promise<void>} restart
 */

/**
 * @returns {boolean}
 */
export function isSystemd() {
  const systemctl = which("systemctl");
  if (!systemctl) {
    return false;
  }

  const systemdPath = join("etc", "systemd", "system");
  if (!existsSync(systemdPath)) {
    return false;
  }

  return true;
}

/**
 * @returns {boolean}
 */
export function isOpenRc() {
  const openRcPath = join("etc", "init.d");
  if (!existsSync(openRcPath)) {
    return false;
  }

  return true;
}

/**
 * @param {string} name
 * @param {string} service
 * @returns {Service}
 */
export function getSystemdService(name, service) {
  const systemctl = which("systemctl");
  const systemdPath = join("etc", "systemd", "system");

  return {
    name,
    async install() {
      writeFile(join(systemdPath, `${name}.service`), service);
      await spawnSafe([systemctl, "daemon-reload"]);
    },
    async enable() {
      await spawnSafe([systemctl, "enable", name], { stdio: "inherit" });
    },
    async disable() {
      await spawnSafe([systemctl, "disable", name], { stdio: "inherit" });
    },
    async start() {
      await spawnSafe([systemctl, "start", name], { stdio: "inherit" });
    },
    async stop() {
      await spawnSafe([systemctl, "stop", name], { stdio: "inherit" });
    },
    async restart() {
      await spawnSafe([systemctl, "restart", name], { stdio: "inherit" });
    },
  };
}

/**
 * @param {string} name
 * @param {string} service
 * @returns {Service}
 */
export function getOpenRcService(name, service) {
  const configPath = join("etc", "init.d");
  const serviceRc = which("rc-service");
  const updateRc = which("rc-update");

  return {
    name,
    async install() {
      const servicePath = join(configPath, name);
      writeFile(servicePath, service, { mode: 0o755 });
    },
    async enable() {
      await spawnSafe([updateRc, "add", name, "default"], { stdio: "inherit" });
    },
    async disable() {
      await spawnSafe([updateRc, "del", name, "default"], { stdio: "inherit" });
    },
    async start() {
      await spawnSafe([serviceRc, name, "start"], { stdio: "inherit" });
    },
    async stop() {
      await spawnSafe([serviceRc, name, "stop"], { stdio: "inherit" });
    },
    async restart() {
      await spawnSafe([serviceRc, name, "restart"], { stdio: "inherit" });
    },
  };
}

/**
 * @param {...string} args
 * @returns {string}
 */
function getPath(...args) {
  const lastArg = args.at(-1);
  const options = typeof lastArg === "object" ? lastArg : undefined;
  const paths = options ? args.slice(0, -1) : args;
  const path = join(...paths);

  if (options?.["clean"]) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true });
    }
  }

  if (options?.["mkdir"]) {
    mkdirSync(path, { recursive: true });
  } else if (options?.["touch"]) {
    appendFileSync(path, "");
  }

  if (options?.["uid"] && options?.["gid"]) {
    chownSync(path, options["uid"], options["gid"]);
  }

  return path;
}

export async function main() {
  const service = await getAgentService("");
  const { name } = service;
  console.log("Created service:", name);

  await service.install();
  console.log("Installed service:", name);

  await service.enable();
  console.log("Enabled service:", name);
}

await main();
