#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import { copyFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  getAbi,
  getAbiVersion,
  getArch,
  getCloud,
  getCloudMetadataTag,
  getDistro,
  getDistroVersion,
  getEnv,
  getHostname,
  getKernel,
  getOs,
  homedir,
  isMacOS,
  isPosix,
  isWindows,
  mkdir,
  spawnSafe,
  which,
  writeFile,
} from "./utils.mjs";

// The macOS major version that constitutes the `release-tier=latest` pool for
// darwin test agents. Anything older self-tags as `release-tier=previous`.
// Bump when a new macOS ships and the first runner on it is online.
const LATEST_DARWIN_RELEASE = 26;

/**
 * @param {"install" | "start"} action
 * @param {{ queue?: string }} [cliOptions]
 */
async function doBuildkiteAgent(action, cliOptions = {}) {
  const username = "buildkite-agent";
  const command = which("buildkite-agent", { required: true });

  let homePath, cachePath, logsPath, agentLogPath, pidPath, cfgPath;
  if (isWindows) {
    homePath = "C:\\buildkite-agent";
    cachePath = join(homePath, "cache");
    logsPath = join(homePath, "logs");
    agentLogPath = join(logsPath, "buildkite-agent.log");
  } else if (isMacOS) {
    // Match what's already deployed on the macOS CI fleet so install/start are
    // idempotent against existing boxes.
    const library = join(homedir(), "Library");
    homePath = join(library, "Services", "buildkite-agent");
    cachePath = join(library, "Caches", "buildkite-agent");
    logsPath = join(library, "Logs", "buildkite-agent");
    agentLogPath = join(logsPath, "buildkite-agent.log");
    cfgPath = join(library, "Preferences", "buildkite-agent.cfg");
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
      mkdir(logsPath);

      const nssm = which("nssm", { required: true });
      const nssmCommands = [
        [nssm, "install", "buildkite-agent", command, ...args],
        [nssm, "set", "buildkite-agent", "Start", "SERVICE_AUTO_START"],
        [nssm, "set", "buildkite-agent", "AppDirectory", homePath],
        [nssm, "set", "buildkite-agent", "AppStdout", agentLogPath],
        [nssm, "set", "buildkite-agent", "AppStderr", agentLogPath],
      ];
      for (const command of nssmCommands) {
        await spawnSafe(command, { stdio: "inherit" });
      }
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
        start_stop_daemon_args=" \\
          --background \\
          --make-pidfile \\
          --stdout ${escape(agentLogPath)} \\
          --stderr ${escape(agentLogPath)}"

        depend() {
          need net
          use dns logger
        }
      `;
      writeFile(servicePath, service, { mode: 0o755 });
      await spawnSafe(["rc-update", "add", "buildkite-agent", "default"], { stdio: "inherit", privileged: true });
    }

    if (isMacOS) {
      const queue = cliOptions.queue || getEnv("BUILDKITE_AGENT_QUEUE", false) || "test-darwin";
      const token = getEnv("BUILDKITE_AGENT_TOKEN", false);
      if (!token && !existsSync(cfgPath)) {
        throw new Error("BUILDKITE_AGENT_TOKEN not set and no existing buildkite-agent.cfg to reuse");
      }

      // `install` runs via sudo, so process.env.USER is "root". The launchd
      // service must run as the real login user (whose ~/Library the cfg and
      // build dirs live under), and the files we write here must be owned by
      // them so the service can read them.
      const runAsUser = process.env.SUDO_USER || process.env.USER || "administrator";

      for (const dir of [homePath, cachePath, logsPath]) {
        mkdir(dir);
      }

      // Copy this script and its imports into homePath so the launchd plist
      // doesn't depend on the checkout that ran `install` sticking around.
      const srcDir = fileURLToPath(new URL(".", import.meta.url));
      for (const f of ["agent.mjs", "utils.mjs"]) {
        copyFileSync(join(srcDir, f), join(homePath, f));
      }
      // Stable node path (the Homebrew/usr-local symlink, not a Cellar version
      // path that breaks on `brew upgrade node`).
      const nodePath = which("node") || process.execPath;
      const installedScript = join(homePath, "agent.mjs");

      // Preserve an existing token line if we're re-installing on a box that
      // already has one and BUILDKITE_AGENT_TOKEN wasn't supplied this time.
      let tokenLine = token ? `token=${escape(token)}` : undefined;
      if (!tokenLine) {
        const existing = readFileSync(cfgPath, "utf8");
        tokenLine = existing.split("\n").find(l => l.startsWith("token="));
      }

      // Intentionally no `spawn=` line: macOS test runners run one job at a
      // time. The test suite assumes it owns the machine (shared /private/tmp
      // shims, ncpu-sized install thread pools, etc.), so multi-worker
      // configurations time out — scale with more boxes, not more workers.
      const cfg = [
        "# Generated by scripts/agent.mjs",
        "# https://buildkite.com/docs/agent/v3/configuration",
        "",
        tokenLine,
        `queue=${escape(queue)}`,
        "",
      ].join("\n");
      writeFile(cfgPath, cfg, { mode: 0o600 });

      const plistPath = "/Library/LaunchDaemons/buildkite-agent.plist";
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>buildkite-agent</string>
  <key>UserName</key><string>${runAsUser}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/rust/bin:${homedir()}/go/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${installedScript}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${agentLogPath}</string>
  <key>StandardErrorPath</key><string>${agentLogPath}</string>
  <key>WorkingDirectory</key><string>${homePath}</string>
  <key>WatchPaths</key><array><string>${cfgPath}</string></array>
</dict>
</plist>
`;
      writeFile(plistPath, plist, { mode: 0o644 });

      // Matches the script already deployed on the fleet: covers both the
      // Homebrew-agent layout (older x64 boxes) and the Library layout (this
      // installer), fixes ownership, then reboots.
      const cleanupPlistPath = "/Library/LaunchDaemons/com.buildkite.cleanup.plist";
      const cleanupScript =
        `PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; ` +
        `BASE_PREFIX=$([ "$(uname -m)" = "arm64" ] && echo "/opt/homebrew" || echo "/usr/local"); ` +
        `{ rm -rf $BASE_PREFIX/{var,etc}/buildkite-agent/{builds,cache}/* ${homePath}/{builds,cache}/* /tmp/* /var/tmp/* || true; } && ` +
        `{ chown -R ${runAsUser}:admin $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; } && ` +
        `{ chmod -R 755 $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; } && ` +
        `{ shutdown -r now || reboot; }`;
      const cleanupPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.buildkite.cleanup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string><![CDATA[${cleanupScript}]]></string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>27</integer></dict>
</dict>
</plist>
`;
      writeFile(cleanupPlistPath, cleanupPlist, { mode: 0o644 });

      // install runs as root, so everything above is root-owned. The service
      // runs as runAsUser and needs to read the cfg (mode 0600) and write to
      // the build/log/cache dirs.
      await spawnSafe(["chown", "-R", `${runAsUser}:staff`, cfgPath, homePath, cachePath, logsPath], {
        stdio: "inherit",
      });

      // Best-effort: replace any previously-loaded service. bootout fails if
      // not loaded, which is fine.
      for (const p of [plistPath, cleanupPlistPath]) {
        await spawnSafe(["launchctl", "bootout", "system", p], { stdio: "inherit" }).catch(() => {});
        await spawnSafe(["launchctl", "bootstrap", "system", p], { stdio: "inherit", privileged: true });
      }
      return;
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

    const hasCfg = isMacOS && existsSync(cfgPath);
    if (!token && !hasCfg) {
      throw new Error(
        "Buildkite token not found: either set BUILDKITE_AGENT_TOKEN or add a buildkite:token label to the instance",
      );
    }

    let shell;
    if (isWindows) {
      // Command Prompt has a faster startup time than PowerShell.
      // Also, it propogates the exit code of the command, which PowerShell does not.
      const cmd = which("cmd", { required: true });
      shell = `"${cmd}" /S /C`;
    } else {
      const sh = which("sh", { required: true });
      shell = `${sh} -elc`;
    }

    const distroVersion = getDistroVersion();
    const flags = ["enable-job-log-tmpfile", "no-feature-reporting"];
    const options = {
      // On macOS the hostname is often a meaningless asset ID (e.g. 66783.local),
      // so name the agent by what it actually is. %spawn yields the existing
      // fleet's "-1" suffix at spawn=1.
      "name": isMacOS ? `${getOs()}-${getArch()}-${distroVersion}-%spawn` : `${getHostname()}-%spawn`,
      "shell": shell,
      "job-log-path": logsPath,
      "build-path": join(homePath, "builds"),
      "hooks-path": join(homePath, "hooks"),
      "plugins-path": join(homePath, "plugins"),
      "experiment": "normalised-upload-paths,resolve-commit-after-checkout,agent-api",
    };

    // On macOS, token/queue/spawn live in the cfg file written by `install`;
    // pass it via --config so re-running `install` is the single edit point.
    // On other platforms, keep passing the token directly as before.
    if (hasCfg) {
      options["config"] = cfgPath;
    } else {
      options["token"] = token || "xxx";
    }

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
      "posix": isPosix,
      "windows": isWindows,
      "kernel": getKernel(),
      "abi": getAbi(),
      "abi-version": getAbiVersion(),
      "distro": getDistro(),
      "distro-version": distroVersion,
      "release": isMacOS ? distroVersion?.split(".")[0] : undefined,
      // ci.mjs targets darwin test jobs by `release-tier` so each PR runs once
      // on the current macOS (`latest`) and once on whatever older version the
      // remaining fleet has (`previous`). Bump LATEST_DARWIN_RELEASE here when
      // a new macOS ships and the first runner on it is online; existing boxes
      // automatically fall into `previous` without reconfiguration.
      "release-tier": isMacOS
        ? parseInt(distroVersion?.split(".")[0] || "0") >= LATEST_DARWIN_RELEASE
          ? "latest"
          : "previous"
        : undefined,
      "ephemeral": ephemeral || false,
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
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
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
  const { positionals: args, values } = parseArgs({
    allowPositionals: true,
    options: {
      queue: { type: "string" },
    },
  });

  if (!args.length || args.includes("install")) {
    console.log("Installing agent...");
    await doBuildkiteAgent("install", values);
    console.log("Agent installed.");
  }

  // `exec` is what the macOS launchd plist invokes; treat it as `start`.
  if (args.includes("start") || args.includes("exec")) {
    console.log("Starting agent...");
    await doBuildkiteAgent("start", values);
    console.log("Agent started.");
  }
}

await main();
