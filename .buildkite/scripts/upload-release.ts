#!/usr/bin/env node

// upload-release.ts canary: replaces the files of the canary release, on main.
// upload-release.ts draft: replaces the draft releases of a release branch.

import { spawnSync } from "node:child_process";
import { createHash, createSign } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Command, getArch, request, requireCommand, run, which } from "../../scripts/agent.ts";
import { getEnv, isMainBranch, readSecret, reportAnnotationToBuildkite } from "../../scripts/buildkite.ts";
import { checkRelease, repository, updaterRepository } from "../../scripts/check-release.ts";

export const artifacts = [
  "darwin-aarch64",
  "darwin-x64",
  "linux-aarch64",
  "linux-x64",
  "linux-aarch64-musl",
  "linux-x64-musl",
  "linux-aarch64-android",
  "linux-x64-android",
  "freebsd-aarch64",
  "freebsd-x64",
  "windows-x64",
  "windows-aarch64",
].flatMap(target => [`bun-${target}.zip`, `bun-${target}-profile.zip`]);

/** x64 ships one binary. Older `bun upgrade` clients still ask for it by its `-baseline` name. */
export function getBaselineAlias(artifact: string): string | undefined {
  return artifact.includes("-x64") ? artifact.replace(/(-profile)?\.zip$/, "-baseline$1.zip") : undefined;
}

async function trace(command: Command, options?: { cwd?: string }): Promise<void> {
  console.log("+", command.join(" "));
  await run(command, options);
}

/** Each puts its program in `<directory>/bin`. */
const installers = {
  async "gh"(directory: string) {
    // From the redirect, because the API is rate limited by IP address until there is a token.
    const { url } = await fetch("https://github.com/cli/cli/releases/latest", { method: "HEAD" });
    const version = /\/tag\/v(.+)$/.exec(url)?.[1];
    if (!version) {
      throw new Error(`Cannot determine the latest version of gh from ${url}`);
    }
    const file = `gh_${version}_linux_${getArch() === "x64" ? "amd64" : "arm64"}.tar.gz`;
    const download = `https://github.com/cli/cli/releases/download/v${version}/${file}`;
    await trace(["curl", "-fsSL", download, "-o", file], { cwd: directory });
    await trace(["tar", "-xzf", file, "--strip-components=1"], { cwd: directory });
  },
  async "aws"(directory: string) {
    const file = `awscli-exe-linux-${getArch() === "x64" ? "x86_64" : "aarch64"}.zip`;
    await trace(["curl", "-fsSL", `https://awscli.amazonaws.com/${file}`, "-o", file], { cwd: directory });
    await trace(["unzip", "-q", file], { cwd: directory });
    await trace([join(directory, "aws", "install"), "-i", join(directory, "aws-cli"), "-b", join(directory, "bin")]);
  },
  async "sentry-cli"(directory: string) {
    await trace(["curl", "-fsSL", "https://sentry.io/get-cli/", "-o", "install.sh"], { cwd: directory });
    await trace(["env", `INSTALL_DIR=${join(directory, "bin")}`, "sh", "install.sh"], { cwd: directory });
  },
};

/** Into a temporary directory, because the agent has no root. */
async function installCommand(name: keyof typeof installers): Promise<void> {
  if (which([name])) {
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), `${name}-`));
  mkdirSync(join(directory, "bin"));
  await installers[name](directory);
  process.env.PATH = `${join(directory, "bin")}:${process.env.PATH}`;
  requireCommand(name);
}

function exportSecrets(...names: string[]): void {
  for (const name of names) {
    process.env[name] = readSecret(name);
  }
}

async function github<T>(method: string, path: string, body?: object, token = getEnv("GH_TOKEN")): Promise<T> {
  const { error, body: response } = await request(`https://api.github.com/${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
    ...(body && { body: JSON.stringify(body) }),
    json: method !== "DELETE",
    attempts: 3,
  });
  if (error) {
    throw error;
  }
  return response as T;
}

async function githubPages<Page, Item>(path: string, getItems: (page: Page) => Item[]): Promise<Item[]> {
  const perPage = 100;
  const items: Item[] = [];
  for (let page = 1; ; page++) {
    const more = getItems(await github<Page>("GET", `${path}?per_page=${perPage}&page=${page}`));
    items.push(...more);
    if (more.length < perPage) {
      return items;
    }
  }
}

/**
 * Exports an installation access token of the bun-release-upload app as GH_TOKEN, where gh expects it.
 * @link https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
async function signInToGithub(): Promise<void> {
  await installCommand("gh");
  const clientId = "Iv23li0GlmKSYj59x7e3";
  const installationId = "177437987";
  const privateKey = Buffer.from(readSecret("GITHUB_APP_BUN_RELEASE_UPLOAD_PRIVATE_KEY_BASE64"), "base64");

  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    { typ: "JWT", alg: "RS256" },
    { iat: now - 60, exp: now + 300, iss: clientId },
  ]
    .map(part => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;

  const path = `app/installations/${installationId}/access_tokens`;
  const { token } = await github<{ token: string }>("POST", path, undefined, jwt);
  const { status } = spawnSync("buildkite-agent", ["redactor", "add"], { input: token, stdio: ["pipe", 1, 2] });
  if (status !== 0) {
    throw new Error("Failed to redact the GitHub token from the log");
  }
  process.env.GH_TOKEN = token;
}

/**
 * Not done by the build step, whose alias of a zip that is signed later would hold the unsigned binary. Read with
 * unzip because `cmake -E tar xf` exits with 0 on a truncated archive, and written with cmake because the image has no
 * zip.
 */
async function rezip(source: string, destination: string): Promise<void> {
  const [from, to] = [source.slice(0, -".zip".length), destination.slice(0, -".zip".length)];
  const directory = mkdtempSync(join(tmpdir(), "rezip-"));
  await trace(["unzip", "-q", "-d", directory, source]);
  renameSync(join(directory, from), join(directory, to));
  await trace(["cmake", "-E", "tar", "cf", resolve(destination), "--format=zip", to], { cwd: directory });
  rmSync(directory, { recursive: true });
}

/** Puts the files of a release in the current directory. */
async function downloadFiles(getStep: (artifact: string) => string | undefined): Promise<string[]> {
  for (const command of ["buildkite-agent", "unzip", "cmake"]) {
    requireCommand(command);
  }

  const downloads = await Promise.allSettled(
    artifacts.map(async artifact => {
      const step = getStep(artifact);
      await trace(["buildkite-agent", "artifact", "download", artifact, ".", ...(step ? ["--step", step] : [])]);
      if (!existsSync(artifact)) {
        throw new Error(`Cannot find the artifact ${artifact}`);
      }
    }),
  );
  const errors = downloads.flatMap(download => (download.status === "rejected" ? [download.reason as Error] : []));
  if (errors.length) {
    throw new Error(errors.map(({ message }) => message).join("\n"));
  }

  const files = [...artifacts];
  for (const artifact of artifacts) {
    const alias = getBaselineAlias(artifact);
    if (alias) {
      await rezip(artifact, alias);
      files.push(alias);
    }
  }
  return files;
}

async function announceCanary(commit: string): Promise<void> {
  let webhook: string;
  try {
    webhook = readSecret("BUN_ANNOUNCE_CANARY_WEBHOOK_URL");
  } catch {
    console.warn("BUN_ANNOUNCE_CANARY_WEBHOOK_URL is not set, skipping the Discord announcement");
    return;
  }

  const link = `[${commit.slice(0, 7)}](https://github.com/${repository}/commit/${commit})`;
  const embed = {
    title: "New Bun Canary now available",
    description: `A new canary build of Bun has been automatically uploaded (${link}). To upgrade, run:\n\n\`\`\`shell\nbun upgrade --canary\n\`\`\`\nCommit: \`${commit}\``,
    color: 16023551,
    timestamp: new Date().toISOString(),
  };
  const { error, status } = await request(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
    attempts: 1,
  });
  if (error) {
    throw new Error(`Failed to announce the canary on Discord: ${status ?? "no response"}`);
  }
}

async function uploadCanary(): Promise<void> {
  if (!isMainBranch() || getEnv("BUILDKITE_PULL_REQUEST") !== "false") {
    throw new Error("The canary is only uploaded from main");
  }
  const commit = getEnv("BUILDKITE_COMMIT");

  await signInToGithub();
  await installCommand("aws");
  exportSecrets("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT");
  const bucket = readSecret("AWS_BUCKET", "--skip-redaction");
  await installCommand("sentry-cli");
  exportSecrets("SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT");

  const files = await downloadFiles(() => undefined);

  // In one command, because uploads of single files raced on the release.
  await trace(["gh", "release", "upload", "canary", ...files, "--clobber", "--repo", repository]);
  const notes = `This release of Bun corresponds to the commit: ${commit}`;
  await trace(["gh", "release", "edit", "canary", "--repo", repository, "--notes", notes]);

  const release = `${commit}-canary`;
  await trace(["sentry-cli", "releases", "new", release, "--finalize"]);
  await trace(["sentry-cli", "releases", "set-commits", release, "--auto", "--ignore-missing"]);
  await trace(["sentry-cli", "deploys", "new", "--env=canary", `--release=${release}`]);

  await announceCanary(commit);

  // S3 is a mirror. `bun upgrade` and install.sh read the GitHub release, so the canary has shipped by now.
  for (const file of files) {
    for (const folder of [release, "canary"]) {
      const destination = `s3://${bucket}/releases/${folder}/${file}`;
      await trace(["aws", `--endpoint-url=${getEnv("AWS_ENDPOINT")}`, "s3", "cp", file, destination]).catch(
        (error: Error) => console.warn(error.message),
      );
    }
  }
}

interface Comparison {
  aheadBy: number;
  headTarget: {
    history: { nodes: { author: { user: { login: string } | null } | null }[]; pageInfo: { endCursor: string } };
  };
}

/** The REST comparison builds the diff too, which can time out, and `compare.commits` stops at 1000. */
async function listAuthors(tag: string, commit: string): Promise<string[]> {
  const [owner, name] = repository.split("/");
  const query = `query($owner: String!, $name: String!, $tag: String!, $commit: String!, $after: String) {
    repository(owner: $owner, name: $name) { ref(qualifiedName: $tag) { compare(headRef: $commit) {
      aheadBy
      headTarget { ... on Commit { history(first: 100, after: $after) {
        nodes { author { user { login } } }
        pageInfo { endCursor }
      } } }
    } } }
  }`;
  const authors: (string | undefined)[] = [];
  let after: string | undefined;
  while (true) {
    const { data, errors } = await github<{
      data: { repository: { ref: { compare: Comparison } } };
      errors?: { message: string }[];
    }>("POST", "graphql", { query, variables: { owner, name, tag: `refs/tags/${tag}`, commit, after } });
    if (errors) {
      throw new Error(`Failed to list the commits since ${tag}: ${errors.map(({ message }) => message).join(", ")}`);
    }
    const { aheadBy, headTarget } = data.repository.ref.compare;
    authors.push(...headTarget.history.nodes.map(({ author }) => author?.user?.login));
    if (authors.length >= aheadBy) {
      // Pull requests are squashed, so the commits since the tag come first.
      return authors.slice(0, aheadBy).filter(login => login !== undefined);
    }
    after = headTarget.history.pageInfo.endCursor;
  }
}

async function getReleaseNotes(version: string, previousTag: string, commit: string): Promise<string> {
  // From commits, because GitHub's generated notes find no pull request behind a cherry-picked commit.
  const logins = (await listAuthors(previousTag, commit)).filter(login => !login.endsWith("[bot]"));
  const contributors = [...new Set(logins)].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

  return `To install Bun v${version}
\`\`\`bash
curl -fsSL https://bun.com/install | bash
# or you can use npm
# npm install -g bun
\`\`\`

Windows:
\`\`\`bash
powershell -c "irm bun.com/install.ps1|iex"
\`\`\`

To upgrade to Bun v${version}:
\`\`\`bash
bun upgrade
\`\`\`

### [Read Bun v${version}'s release notes on Bun's blog](https://bun.com/blog/bun-v${version})

### Thanks to ${contributors.length} contributors!

${contributors.map(login => `- [@${login}](https://github.com/${login})\n`).join("")}`;
}

interface Release {
  id: number;
  draft: boolean;
  tag_name: string;
  html_url: string;
}

interface Asset {
  name: string;
  digest: string | null;
}

async function listDrafts(repo: string, tag: string): Promise<number[]> {
  const releases = await githubPages(`repos/${repo}/releases`, (page: Release[]) => page);
  return releases.filter(({ draft, tag_name }) => draft && tag_name === tag).map(({ id }) => id);
}

async function getDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** The id of the draft, once it is known to hold exactly the files that `digests` names. */
async function verifyDraft(repo: string, tag: string, digests: Map<string, string>): Promise<number> {
  const [id, ...others] = await listDrafts(repo, tag);
  if (id === undefined || others.length) {
    throw new Error(`Expected one draft of ${tag} on ${repo}, found: ${[id ?? "none", ...others].join(", ")}`);
  }
  const assets = await githubPages(`repos/${repo}/releases/${id}/assets`, (page: Asset[]) => page);
  const uploaded = new Map(assets.map(({ name, digest }) => [name, digest]));
  const names = new Set([...digests.keys(), ...uploaded.keys()]);
  const different = [...names].filter(name => uploaded.get(name) !== digests.get(name));
  if (different.length) {
    throw new Error(`The draft on ${repo} differs from this build in: ${different.join(", ")}`);
  }
  return id;
}

async function uploadDrafts(): Promise<void> {
  // GitHub shows the account that created the draft as the author of the release, whoever publishes it.
  const authorToken = readSecret("RELEASE_DRAFT_GITHUB_TOKEN");

  // A signed zip has the name of the unsigned one that build-bun uploaded.
  const files = await downloadFiles(artifact => /^bun-(windows|darwin)-/.exec(artifact)?.[1]?.concat("-sign"));
  await signInToGithub();

  // Checked when the build started, but the branch and the tags can have moved since.
  const { version, commit, previousTag } = checkRelease();
  const tag = `bun-v${version}`;
  const title = `Bun v${version}`;
  const notes = await getReleaseNotes(version, previousTag, commit);

  // By id, because the `gh release` commands that take a tag also match a published release.
  for (const repo of [repository, updaterRepository]) {
    for (const id of await listDrafts(repo, tag)) {
      console.log(`Deleting draft ${id} of ${repo}`);
      await github("DELETE", `repos/${repo}/releases/${id}`);
    }
  }

  const create = ["gh", "release", "create", tag, ...files, "--draft"] satisfies Command;
  const incomplete = `${title} (incomplete, do not publish)`;
  const appToken = getEnv("GH_TOKEN");
  process.env.GH_TOKEN = authorToken;
  await trace([...create, "--repo", repository, "--title", incomplete, "--notes", notes, "--target", commit]);
  process.env.GH_TOKEN = appToken;
  await trace([...create, "--repo", updaterRepository, "--title", incomplete, "--notes", "bunbunbun"]);

  const digests = new Map<string, string>();
  for (const file of files) {
    digests.set(file, await getDigest(file));
  }
  const id = await verifyDraft(repository, tag, digests);
  const updaterId = await verifyDraft(updaterRepository, tag, digests);

  // Editing a draft without its tag_name clears the tag.
  const ready = { tag_name: tag, name: title };
  // The draft that is published first is the last to look ready.
  const updaterDraft = await github<Release>("PATCH", `repos/${updaterRepository}/releases/${updaterId}`, ready);
  const draft = await github<Release>("PATCH", `repos/${repository}/releases/${id}`, ready, authorToken);

  const content = `The drafts of ${title} are ready. Check the tests of this build, then publish them in this order:

1. [${repository}](${draft.html_url})
2. [${updaterRepository}](${updaterDraft.html_url})
`;
  console.log(content);
  reportAnnotationToBuildkite({ label: "release", content, style: "info", priority: 10, append: false });
}

if (import.meta.main) {
  const [kind] = process.argv.slice(2);
  if (kind === "canary") {
    await uploadCanary();
  } else if (kind === "draft") {
    await uploadDrafts();
  } else {
    throw new Error(`Expected canary or draft, got: ${kind}`);
  }
}
