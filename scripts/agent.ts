#!/usr/bin/env node

// An agent that starts buildkite-agent and runs others services.

import { createHash, createHmac } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir as nodeHomedir, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, parseArgs } from "node:util";
import {
  curl,
  getAbi,
  getAbiVersion,
  getArch,
  getDistro,
  getDistroVersion,
  getEnv,
  getHostname,
  getKernel,
  getOs,
  isLinux,
  isMacOS,
  isPosix,
  isWindows,
  mkdir,
  spawn,
  spawnSafe,
  which,
  writeFile,
} from "./utils.ts";

function homedir(): string {
  return nodeHomedir();
}

type Cloud = "aws" | "google" | "azure";

let detectedCloud: Cloud | undefined;

async function isAws(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "aws";
  }

  async function checkAws(): Promise<boolean | undefined> {
    if (isLinux) {
      const kernel = release();
      if (kernel.endsWith("-aws")) {
        return true;
      }

      const { error: systemdError, stdout } = await spawn(["systemd-detect-virt"]);
      if (!systemdError) {
        if (stdout.includes("amazon")) {
          return true;
        }
      }

      const dmiPath = "/sys/devices/virtual/dmi/id/board_asset_tag";
      if (existsSync(dmiPath)) {
        const dmiFile = readFileSync(dmiPath, { encoding: "utf-8" });
        if (dmiFile.startsWith("i-")) {
          return true;
        }
      }
    }

    if (isWindows) {
      const executionEnv = getEnv("AWS_EXECUTION_ENV", false);
      if (executionEnv === "EC2") {
        return true;
      }

      const { error: powershellError, stdout } = await spawn([
        "powershell",
        "-Command",
        "Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object Manufacturer",
      ]);
      if (!powershellError) {
        return stdout.includes("Amazon");
      }
    }

    return undefined;
  }

  if (await checkAws()) {
    detectedCloud = "aws";
    return true;
  }

  return undefined;
}

async function isGoogleCloud(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "google";
  }

  async function detectGoogleCloud(): Promise<boolean | undefined> {
    if (isLinux) {
      const vendorPaths = [
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/bios_vendor",
        "/sys/class/dmi/id/product_name",
      ];

      for (const vendorPath of vendorPaths) {
        if (existsSync(vendorPath)) {
          const vendorFile = readFileSync(vendorPath, { encoding: "utf-8" });
          if (vendorFile.includes("Google")) {
            return true;
          }
        }
      }
    }

    return undefined;
  }

  if (await detectGoogleCloud()) {
    detectedCloud = "google";
    return true;
  }

  return undefined;
}

/** The fields of the Azure IMDS instance document that are read here. */
type AzureInstanceMetadata = {
  compute?: {
    azEnvironment?: string;
    tagsList?: { name: string; value: string }[];
  };
} | null;

async function isAzure(): Promise<boolean | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud === "azure";
  }

  async function detectAzure(): Promise<boolean | undefined> {
    // Azure IMDS (Instance Metadata Service) — the official way to detect Azure VMs.
    // https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service
    const { error, body } = await curl("http://169.254.169.254/metadata/instance?api-version=2021-02-01", {
      headers: { "Metadata": "true" },
      retries: 1,
    });
    if (!error && typeof body === "string" && body) {
      try {
        const metadata = JSON.parse(body) as AzureInstanceMetadata;
        if (metadata?.compute?.azEnvironment) {
          return true;
        }
      } catch {}
    }

    return undefined;
  }

  if (await detectAzure()) {
    detectedCloud = "azure";
    return true;
  }

  return undefined;
}

async function getCloud(): Promise<Cloud | undefined> {
  if (typeof detectedCloud === "string") {
    return detectedCloud;
  }

  if (await isAws()) {
    return "aws";
  }

  if (await isGoogleCloud()) {
    return "google";
  }

  if (await isAzure()) {
    return "azure";
  }

  return undefined;
}

/**
 * `name` is the path of the metadata entry, or one path per cloud. There is
 * no azure path: Azure serves one JSON document, and the caller picks fields
 * out of it.
 */
async function getCloudMetadata(
  name: string | { aws: string; google: string },
  cloud?: Cloud,
): Promise<string | undefined> {
  cloud ??= await getCloud();
  if (!cloud) {
    return;
  }

  if (typeof name === "object") {
    name = cloud === "azure" ? "" : name[cloud];
  }

  let url;
  let headers;
  if (cloud === "aws") {
    url = new URL(name, "http://169.254.169.254/latest/meta-data/");
  } else if (cloud === "google") {
    url = new URL(name, "http://metadata.google.internal/computeMetadata/v1/instance/");
    headers = { "Metadata-Flavor": "Google" };
  } else if (cloud === "azure") {
    // Azure IMDS uses a single JSON endpoint; individual fields are extracted by the caller.
    url = new URL("http://169.254.169.254/metadata/instance?api-version=2021-02-01");
    headers = { "Metadata": "true" };
  } else {
    throw new Error(`Unsupported cloud: ${inspect(cloud)}`);
  }

  const { error, body } = await curl(url, { headers, retries: 10 });
  if (error) {
    console.warn("Failed to get cloud metadata:", error);
    return;
  }

  // Without the json, arrayBuffer or filename option, the body of a response is its text.
  return typeof body === "string" ? body.trim() : undefined;
}

async function getCloudMetadataTag(tag: string, cloud?: Cloud): Promise<string | undefined> {
  cloud ??= await getCloud();

  if (cloud === "azure") {
    // Azure IMDS returns all tags in a single JSON response.
    // Tags are in compute.tagsList as [{name, value}, ...].
    const body = await getCloudMetadata("", cloud);
    if (!body) return;
    try {
      const metadata = JSON.parse(body) as AzureInstanceMetadata;
      const tags = metadata?.compute?.tagsList;
      if (Array.isArray(tags)) {
        const entry = tags.find(t => t.name === tag);
        return entry?.value;
      }
    } catch {}
    return;
  }

  const metadata = {
    "aws": `tags/instance/${tag}`,
    "google": `labels/${tag.replace(":", "-")}`,
  };

  return getCloudMetadata(metadata, cloud);
}

type AwsCredentials = {
  AccessKeyId: string;
  SecretAccessKey: string;
  Token?: string;
};

/**
 * Instance-role credentials from IMDS.
 */
async function getAwsInstanceCredentials(): Promise<AwsCredentials | undefined> {
  const role = await getCloudMetadata("iam/security-credentials/", "aws");
  if (!role) {
    return;
  }
  const body = await getCloudMetadata(`iam/security-credentials/${role.trim()}`, "aws");
  if (!body) {
    return;
  }
  try {
    return JSON.parse(body) as AwsCredentials;
  } catch {
    return;
  }
}

type AwsRequest = {
  method: string;
  host: string;
  path: string;
  body: string;
  service: string;
  region: string;
  headers: Record<string, string>;
  credentials: AwsCredentials;
  date?: Date;
};

/**
 * Signs an AWS API request (SigV4). agent.ts and this file are all that is
 * installed on a CI machine, so there is no SDK to call.
 * @returns headers, including Authorization
 */
function signAwsRequest({
  method,
  host,
  path,
  body,
  service,
  region,
  headers,
  credentials,
  date,
}: AwsRequest): Record<string, string> {
  const { AccessKeyId, SecretAccessKey, Token } = credentials;
  const amzDate = (date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const bodyHash = sha256(body);

  const signed: Record<string, string> = {
    ...headers,
    "host": host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": bodyHash,
  };
  if (Token) {
    signed["x-amz-security-token"] = Token;
  }

  const canonical = Object.entries(signed)
    .map(([key, value]): [string, string] => [key.toLowerCase(), `${value}`.trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = canonical.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = canonical.map(([key]) => key).join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SecretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...signed,
    "Authorization": `AWS4-HMAC-SHA256 Credential=${AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

type AwsSecretOptions = {
  /** defaults to the instance's region */
  region?: string;
  /** defaults to IMDS credentials */
  credentials?: AwsCredentials;
};

/** The field of the Secrets Manager GetSecretValue response that is read here. */
type AwsSecretValue = { SecretString?: string } | null | undefined;

/**
 * Reads a secret from AWS Secrets Manager using the instance role.
 */
async function getAwsSecret(secretId: string, options: AwsSecretOptions = {}): Promise<string | undefined> {
  const region = options["region"] || (await getCloudMetadata("placement/region", "aws")) || "us-east-1";
  const credentials = options["credentials"] || (await getAwsInstanceCredentials());
  if (!credentials) {
    console.warn("Failed to get AWS secret: no instance credentials");
    return;
  }

  const host = `secretsmanager.${region}.amazonaws.com`;
  const body = JSON.stringify({ SecretId: secretId });
  const headers = signAwsRequest({
    method: "POST",
    host,
    path: "/",
    body,
    service: "secretsmanager",
    region,
    credentials,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "secretsmanager.GetSecretValue",
    },
  });

  const { error, body: response } = await curl(`https://${host}/`, {
    method: "POST",
    headers,
    body,
    json: true,
    retries: 5,
  });
  if (error) {
    console.warn("Failed to get AWS secret:", error);
    return;
  }

  return (response as AwsSecretValue)?.["SecretString"];
}

/** The field of the managed identity token response that is read here. */
type AzureIdentityToken = { access_token?: string } | null | undefined;

/** The field of the Key Vault "get secret" response that is read here. */
type AzureSecretValue = { value?: string } | null | undefined;

/**
 * Reads a secret from Azure Key Vault using the VM's managed identity.
 */
async function getAzureSecret(vaultName: string, secretName: string): Promise<string | undefined> {
  const identityUrl =
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fvault.azure.net";
  const { error: identityError, body: identity } = await curl(identityUrl, {
    headers: { "Metadata": "true" },
    json: true,
    retries: 10,
  });
  const accessToken = (identity as AzureIdentityToken)?.["access_token"];
  if (identityError || !accessToken) {
    console.warn("Failed to get Azure managed identity token:", identityError);
    return;
  }

  const secretUrl = `https://${vaultName}.vault.azure.net/secrets/${secretName}?api-version=7.4`;
  const { error, body } = await curl(secretUrl, {
    headers: { "Authorization": `Bearer ${accessToken}` },
    json: true,
    retries: 5,
  });
  if (error) {
    console.warn("Failed to get Azure secret:", error);
    return;
  }

  return (body as AzureSecretValue)?.["value"];
}

function sha256(string: string): string {
  return createHash("sha256").update(Buffer.from(string)).digest("hex");
}

// The buildkite-agent registration token, per cloud. AWS builders read
// Secrets Manager with their instance role; Azure builders read Key Vault
// with their managed identity. It is not in launch parameters or tags.
const BUILDKITE_TOKEN_SECRET = "buildkite/agent-token";
const AZURE_KEYVAULT = "bun-ci";
const AZURE_TOKEN_SECRET = "buildkite-agent-token";

// macOS major-version thresholds for the `release-tier` agent tag.
//   >  LATEST   -> "beta"     (next macOS, pre-release; its own queue)
//   == LATEST   -> "latest"   (current macOS; arm64-only in practice)
//   >= PREVIOUS -> "previous" (recent-but-not-current; 14/15 today)
//   else        -> "oldest"   (min-supported; 13 today)
// Bump LATEST when a new macOS ships and the first runner on it is online.
// Bump PREVIOUS when the floor of "recent" moves.
const LATEST_DARWIN_RELEASE = 26;
const PREVIOUS_DARWIN_RELEASE = 14;

type DarwinReleaseTier = "beta" | "latest" | "previous" | "oldest";

function darwinReleaseTier(distroVersion: string | undefined): DarwinReleaseTier {
  const major = parseInt(distroVersion?.split(".")[0] || "0");
  if (major > LATEST_DARWIN_RELEASE) return "beta";
  if (major >= LATEST_DARWIN_RELEASE) return "latest";
  if (major >= PREVIOUS_DARWIN_RELEASE) return "previous";
  return "oldest";
}

type AgentAction = "install" | "start";

type AgentCliOptions = {
  queue?: string;
};

type AgentPaths = {
  homePath: string;
  cachePath: string;
  logsPath: string;
  agentLogPath: string;
  // Not set on Windows or macOS.
  pidPath?: string;
  // Only set on macOS.
  cfgPath?: string;
};

function getAgentPaths(): AgentPaths {
  if (isWindows) {
    const homePath = "C:\\buildkite-agent";
    const logsPath = join(homePath, "logs");
    return {
      homePath,
      cachePath: join(homePath, "cache"),
      logsPath,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
    };
  } else if (isMacOS) {
    // Match what's already deployed on the macOS CI fleet so install/start are
    // idempotent against existing boxes.
    const library = join(homedir(), "Library");
    const logsPath = join(library, "Logs", "buildkite-agent");
    return {
      homePath: join(library, "Services", "buildkite-agent"),
      cachePath: join(library, "Caches", "buildkite-agent"),
      logsPath,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
      cfgPath: join(library, "Preferences", "buildkite-agent.cfg"),
    };
  } else {
    const logsPath = "/var/log/buildkite-agent";
    return {
      homePath: "/var/lib/buildkite-agent",
      cachePath: "/var/cache/buildkite-agent",
      logsPath,
      agentLogPath: join(logsPath, "buildkite-agent.log"),
      pidPath: join(logsPath, "buildkite-agent.pid"),
    };
  }
}

async function doBuildkiteAgent(action: AgentAction, cliOptions: AgentCliOptions = {}): Promise<void> {
  const username = "buildkite-agent";
  const command = which("buildkite-agent", { required: true });

  const { homePath, cachePath, logsPath, agentLogPath, pidPath, cfgPath } = getAgentPaths();

  async function install(): Promise<void> {
    const command = process.execPath;

    // Checked before anything is written, so a Mac that cannot be given a
    // token is left as it was.
    const token = getEnv("BUILDKITE_AGENT_TOKEN", false);
    if (isMacOS && cfgPath !== undefined && !token && !existsSync(cfgPath)) {
      throw new Error("BUILDKITE_AGENT_TOKEN not set and no existing buildkite-agent.cfg to reuse");
    }

    // The service runs a copy of this script and the utils.ts it imports from
    // the agent's home, so it does not depend on the checkout that ran
    // `install` sticking around. When `install` is run from the home itself
    // (the Windows image bake uploads both files there first), they are
    // already in place.
    mkdir(homePath);
    const srcDir = fileURLToPath(new URL(".", import.meta.url));
    if (realpathSync(srcDir) !== realpathSync(homePath)) {
      for (const f of ["agent.ts", "utils.ts"]) {
        copyFileSync(join(srcDir, f), join(homePath, f));
      }
    }
    // In the repo, scripts/package.json says these are ES modules. The copy
    // says so itself rather than take its module type from whatever
    // package.json sits above the home (on macOS, the user's home directory).
    writeFile(join(homePath, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
    const installedScript = join(homePath, "agent.ts");
    const args = [installedScript, "start"];

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

    // cfgPath is set exactly when isMacOS is; the second check is for the type checker.
    if (isMacOS && cfgPath !== undefined) {
      const queue = cliOptions.queue || getEnv("BUILDKITE_AGENT_QUEUE", false) || "test-darwin";
      // `install` runs via sudo, so process.env.USER is "root". The launchd
      // service must run as the real login user (whose ~/Library the cfg and
      // build dirs live under), and the files we write here must be owned by
      // them so the service can read them.
      const runAsUser = process.env.SUDO_USER || process.env.USER || "administrator";

      for (const dir of [homePath, cachePath, logsPath]) {
        mkdir(dir);
      }

      // Stable node path (the Homebrew/usr-local symlink, not a Cellar version
      // path that breaks on `brew upgrade node`).
      const nodePath = which("node") || process.execPath;

      // Preserve an existing token line if we're re-installing on a box that
      // already has one and BUILDKITE_AGENT_TOKEN wasn't supplied this time.
      let tokenLine: string | undefined = token ? `token=${escape(token)}` : undefined;
      if (!tokenLine) {
        const existing = readFileSync(cfgPath, "utf8");
        tokenLine = existing.split("\n").find(l => l.startsWith("token="));
      }

      // Intentionally no `spawn=` line: macOS test runners run one job at a
      // time. The test suite assumes it owns the machine (shared /private/tmp
      // shims, ncpu-sized install thread pools, etc.), so multi-worker
      // configurations time out — scale with more boxes, not more workers.
      const cfg = [
        "# Generated by scripts/agent.ts",
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

  async function start(): Promise<void> {
    const cloud = await getCloud();

    let token = getEnv("BUILDKITE_AGENT_TOKEN", false);
    if (!token && cloud === "aws") {
      token = await getAwsSecret(BUILDKITE_TOKEN_SECRET);
    }
    if (!token && cloud === "azure") {
      token = await getAzureSecret(AZURE_KEYVAULT, AZURE_TOKEN_SECRET);
    }
    // Images baked before the secret stores existed only had the tag.
    if (!token && cloud) {
      token = await getCloudMetadataTag("buildkite:token");
    }

    const hasCfg = isMacOS && cfgPath !== undefined && existsSync(cfgPath);
    if (!token && !hasCfg) {
      throw new Error(
        "Buildkite token not found: set BUILDKITE_AGENT_TOKEN or grant this machine access to the buildkite agent-token secret",
      );
    }

    let shell: string;
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
    const options: Record<string, string> = {
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

    let ephemeral: boolean | undefined;
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

    const tags: Record<string, string | boolean | undefined> = {
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
      // ci.ts targets darwin test jobs by `release-tier` so each PR runs on
      // distinct OS-age pools without needing per-box config. arm64 uses
      // latest+previous; x64 uses previous+oldest (Intel can't run latest).
      "release-tier": isMacOS ? darwinReleaseTier(distroVersion) : undefined,
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

function isSystemd(): boolean {
  return !!which("systemctl");
}

function isOpenRc(): boolean {
  return !!which("rc-service");
}

function escape(string: string | undefined): string | undefined {
  return JSON.stringify(string);
}

async function main(): Promise<void> {
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
