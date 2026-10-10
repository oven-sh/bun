#!/usr/bin/env bun
// Validate a bun release's SHASUMS256.txt / SHASUMS256.txt.asc.
//
// Default level (no flags beyond the target): verifies that
//   1. the standalone SHASUMS256.txt is byte-identical to the body that
//      was clearsigned into SHASUMS256.txt.asc (so the checksums you
//      check against are exactly what was signed), and
//   2. every manifest entry's sha256 matches the artifact — GitHub's
//      reported asset digest in tag mode, or the actual file bytes in
//      --dir mode.
// No key material is needed or trusted at this level.
//
// Signer level (--require-signer <fingerprint>): additionally verifies
// the PGP signature cryptographically and enforces that it was made by
// the given key fingerprint. Provide the armored public key with
// --pubkey <path> to verify inside an isolated throwaway keyring;
// without --pubkey the user's default gpg keyring is used.
//
// Usage:
//   bun scripts/validate-digests.ts <tag> [--download] [--require-signer <fpr> [--pubkey <path>]]
//   bun scripts/validate-digests.ts --dir <path> [--require-signer <fpr> [--pubkey <path>]]
//
// <tag> accepts "canary", "latest" (the newest stable release), a
// release tag like "bun-v1.0.2", or a bare version like "1.0.2".
// --download hashes downloaded asset bytes when GitHub reports no
// digest for an asset (uploads predating the digest field).
//
// Originally contributed in https://github.com/oven-sh/bun/issues/28931.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Options {
  tag?: string;
  dir?: string;
  download?: boolean;
  requireSigner?: string;
  pubkey?: string;
}

function usage(): never {
  console.error(
    "Usage: bun scripts/validate-digests.ts (<tag> | latest | --dir <path>) [--download] [--require-signer <fingerprint> [--pubkey <path>]]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      // Every value-taking flag fails closed on a missing/empty value.
      // This matters most for --require-signer: silently dropping it
      // would skip an explicitly requested security check.
      case "--dir":
        opts.dir = argv[++i];
        if (!opts.dir) usage();
        break;
      case "--require-signer":
        opts.requireSigner = argv[++i];
        if (!opts.requireSigner) usage();
        break;
      case "--pubkey":
        opts.pubkey = argv[++i];
        if (!opts.pubkey) usage();
        break;
      case "--download":
        opts.download = true;
        break;
      default:
        if (arg.startsWith("--") || opts.tag) usage();
        opts.tag = arg;
    }
  }
  if (!opts.tag && !opts.dir) usage();
  if (opts.tag && opts.dir) usage();
  if (opts.download && opts.dir) usage();
  if (opts.pubkey && !opts.requireSigner) usage();
  return opts;
}

/**
 * Safely constructs the GitHub API URL for a release tag, or for the
 * newest stable release when `latest` is set (the tag is ignored then).
 * Adheres strictly to RFC 3986 scheme, hostname, and path separation.
 */
function buildReleaseUrl(owner: string, repo: string, tag: string, latest = false): string {
  const prefix = `/repos/${owner}/${repo}/releases/`;
  const path = prefix + (latest ? "latest" : `tags/${tag}`);
  return new URL(path, "https://api.github.com").toString();
}

/**
 * Normalize a tag the way the release jobs do: bare versions like
 * "1.0.2" (or "v1.0.2") refer to the GitHub tag "bun-v1.0.2", while
 * "canary" and already-prefixed tags pass through unchanged. Keeps
 * this script accepting the same inputs as the sign job it verifies
 * (release.yml documents the bare form for workflow_dispatch).
 */
function normalizeTag(tag: string): string {
  const m = tag.match(/^v?(\d+\.\d+\.\d+.*)$/);
  return m ? `bun-v${m[1]}` : tag;
}

/** Extract the clearsigned body from a PGP clearsign envelope. */
function extractSignedBody(ascContent: string): string {
  const parts = ascContent.split("-----BEGIN PGP SIGNATURE-----");
  const bodyWithHeader = parts[0].split("-----BEGIN PGP SIGNED MESSAGE-----")[1];
  if (!bodyWithHeader) throw new Error("Invalid PGP structure in .asc file.");
  // Remove the 'Hash: ...' header block and surrounding whitespace.
  return bodyWithHeader.replace(/^[\s\S]*?Hash: .*\r?\n\r?\n/, "").trim();
}

interface ManifestEntry {
  hash: string;
  name: string;
}

/** Parse and syntactically validate the manifest body. */
function parseManifest(body: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    // Enforces: 64-char hex + ('  ' or ' *') + filename.
    const match = line.match(/^([a-fA-F0-9]{64})(  | \*)(.+)$/);
    if (!match) {
      throw new Error(`Malformed manifest line: "${line}". Only '  ' or ' *' separators are valid.`);
    }
    const [, hash, , name] = match;
    if (seen.has(name)) throw new Error(`Duplicate filename detected in manifest: "${name}"`);
    seen.add(name);
    entries.push({ hash, name });
  }
  return entries;
}

/** Normalize a user-supplied fingerprint: strip spaces/colons, uppercase. */
function normalizeFingerprint(raw: string): string {
  const fpr = raw.replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{40}([0-9A-F]{24})?$/.test(fpr)) {
    throw new Error(`--require-signer expects a full 40- or 64-hex-digit key fingerprint, got: "${raw}"`);
  }
  return fpr;
}

/**
 * Verify the clearsign signature with gpg and enforce the signer.
 * With a pubkey, verification happens in an isolated throwaway keyring;
 * otherwise the user's default keyring must already hold the key.
 */
async function verifySigner(ascContent: string, fingerprint: string, pubkeyPath?: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "bun-validate-digests-"));
  const gnupghome = pubkeyPath ? join(work, "gnupg") : undefined;
  try {
    const ascPath = join(work, "SHASUMS256.txt.asc");
    await Bun.write(ascPath, ascContent);
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (gnupghome) {
      mkdirSync(gnupghome, { mode: 0o700 });
      env.GNUPGHOME = gnupghome;
      const imp = Bun.spawnSync({
        cmd: ["gpg", "--batch", "--import", pubkeyPath!],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (imp.exitCode !== 0) {
        throw new Error(`gpg --import failed for ${pubkeyPath}:\n${imp.stderr.toString()}`);
      }
    }
    const verify = Bun.spawnSync({
      cmd: ["gpg", "--batch", "--status-fd", "1", "--verify", ascPath],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const status = verify.stdout.toString();
    if (verify.exitCode !== 0) {
      throw new Error(`gpg --verify failed:\n${verify.stderr.toString()}`);
    }
    // gpg exits 0 and still emits VALIDSIG for signatures made by
    // revoked or expired keys (REVKEYSIG / EXPKEYSIG / EXPSIG), so the
    // exit code alone cannot gate key validity. Parse the status
    // LINE-ANCHORED: gpg embeds the signer's UID unescaped in these
    // lines (only control chars are percent-escaped), so a compromised
    // key could carry a UID containing the literal "[GNUPG:] GOODSIG "
    // and defeat a substring match; a UID can never start a fresh
    // status line because newlines ARE escaped.
    //
    // Policy: revocation always rejects (a compromised release key's
    // revocation must take effect here). Expiry is accepted with a
    // loud warning: an old immutable release's signature cannot be
    // re-made, and a key that expired after signing does not undo the
    // signature's validity at signing time.
    const statusLines = status.split(/\r?\n/);
    const hasStatus = (tag: string) =>
      statusLines.some(l => l === `[GNUPG:] ${tag}` || l.startsWith(`[GNUPG:] ${tag} `));
    if (hasStatus("REVKEYSIG") || hasStatus("KEYREVOKED")) {
      throw new Error("Signature key has been revoked (gpg reported REVKEYSIG).");
    }
    if (hasStatus("EXPKEYSIG") || hasStatus("EXPSIG")) {
      console.warn("⚠️ Signing key has expired since this signature was made; the signature itself verifies.");
    } else if (!hasStatus("GOODSIG")) {
      throw new Error("gpg did not report GOODSIG for the signature.");
    }
    // VALIDSIG <sig-key-fpr> <date> <ts> ... <primary-key-fpr>
    const validsig = status.split(/\r?\n/).find(l => l.startsWith("[GNUPG:] VALIDSIG "));
    if (!validsig) throw new Error("gpg did not report VALIDSIG for the signature.");
    const fields = validsig.split(" ").slice(2);
    const sigKeyFpr = fields[0]?.toUpperCase() ?? "";
    const primaryFpr = fields[fields.length - 1]?.toUpperCase() ?? "";
    if (fingerprint !== sigKeyFpr && fingerprint !== primaryFpr) {
      throw new Error(
        `Signature made by an unexpected key!\n` +
          `  Required: ${fingerprint}\n` +
          `  Signing key: ${sigKeyFpr}\n` +
          `  Primary key: ${primaryFpr}`,
      );
    }
    console.log(`✅ Signature verified: signed by ${fingerprint}.`);
  } finally {
    if (gnupghome) {
      // Best-effort: spawnSync throws ENOENT when gpgconf is absent
      // (GnuPG 1.x, stripped containers), and a throw here would mask
      // the try body's real diagnostic and skip the rmSync below.
      try {
        Bun.spawnSync({
          cmd: ["gpgconf", "--kill", "all"],
          env: { ...process.env, GNUPGHOME: gnupghome } as Record<string, string>,
          stdout: "ignore",
          stderr: "ignore",
        });
      } catch {}
    }
    rmSync(work, { recursive: true, force: true });
  }
}

interface Source {
  txt: string;
  asc: string;
  /** Returns the actual sha256 (lowercase hex) for a manifest entry. */
  digestOf(name: string): Promise<string>;
}

async function loadFromGitHub(tag: string, download: boolean): Promise<Source> {
  // "latest" resolves through GitHub's dedicated endpoint to the
  // newest stable release, so users can validate it without first
  // looking up the current version number.
  const apiUrl = buildReleaseUrl("oven-sh", "bun", normalizeTag(tag), tag === "latest");
  console.log(`Fetching release metadata: ${apiUrl}`);
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
  };
  // Authenticate when a token is available (e.g. the release workflow's
  // validate job) so the metadata call is not subject to the low
  // unauthenticated rate limit shared across CI runners.
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
  }
  const { assets } = (await response.json()) as { assets: any[] };
  const digests = new Map<string, string | null | undefined>(assets.map(a => [a.name, a.digest]));
  const urls = new Map<string, string>(assets.map(a => [a.name, a.browser_download_url]));
  const txtAsset = assets.find(a => a.name === "SHASUMS256.txt");
  const ascAsset = assets.find(a => a.name === "SHASUMS256.txt.asc");
  if (!txtAsset || !ascAsset) throw new Error("Missing required checksum assets.");
  const txt = await fetchAsset(txtAsset.browser_download_url);
  const asc = await fetchAsset(ascAsset.browser_download_url);
  return {
    txt,
    asc,
    async digestOf(name: string) {
      // Distinguish "asset not on the release" from "asset present but
      // GitHub reported no digest" (older uploads have digest: null).
      if (!digests.has(name)) {
        throw new Error(`Asset "${name}" in manifest is not present on the GitHub release.`);
      }
      const raw = digests.get(name);
      if (!raw) {
        if (!download) {
          throw new Error(
            `Asset "${name}" is on the release but GitHub reported no digest for it; ` +
              `re-run with --download to verify it by hashing the downloaded bytes.`,
          );
        }
        // Opt-in fallback: hash the asset bytes ourselves, streaming so
        // multi-hundred-MB archives never sit in memory whole.
        console.log(`No GitHub digest for ${name}; downloading to hash...`);
        const res = await fetch(urls.get(name)!);
        if (!res.ok) {
          throw new Error(`GitHub returned ${res.status} ${res.statusText} for ${urls.get(name)}`);
        }
        const hash = createHash("sha256");
        for await (const chunk of res.body!) {
          hash.update(chunk);
        }
        return hash.digest("hex");
      }
      // GitHub's asset.digest is typically prefixed with 'sha256:'.
      return raw.replace("sha256:", "").toLowerCase();
    },
  };
}

/** Download a release asset, failing with the HTTP status on error. */
async function fetchAsset(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.text()).trim();
}

async function loadFromDir(dir: string): Promise<Source> {
  const txtFile = Bun.file(join(dir, "SHASUMS256.txt"));
  const ascFile = Bun.file(join(dir, "SHASUMS256.txt.asc"));
  if (!(await txtFile.exists())) throw new Error(`Missing ${join(dir, "SHASUMS256.txt")}`);
  if (!(await ascFile.exists())) throw new Error(`Missing ${join(dir, "SHASUMS256.txt.asc")}`);
  return {
    txt: (await txtFile.text()).trim(),
    asc: (await ascFile.text()).trim(),
    async digestOf(name: string) {
      return createHash("sha256")
        .update(readFileSync(join(dir, name)))
        .digest("hex");
    },
  };
}

async function validateDigests() {
  const opts = parseArgs(process.argv.slice(2));
  const fingerprint = opts.requireSigner ? normalizeFingerprint(opts.requireSigner) : undefined;
  const source = opts.dir ? await loadFromDir(opts.dir) : await loadFromGitHub(opts.tag!, opts.download === true);

  // Identity check: standalone .txt must exactly match the signed body,
  // so the checksums verified below are the checksums that were signed.
  const signedBody = extractSignedBody(source.asc);
  if (source.txt !== signedBody) {
    throw new Error("Identity Mismatch: SHASUMS256.txt does not match the signed manifest body.");
  }
  console.log("✅ Identity verified: .txt and signed .asc body are identical.");

  if (fingerprint) {
    await verifySigner(source.asc, fingerprint, opts.pubkey);
  }

  const entries = parseManifest(signedBody);
  for (const { hash, name } of entries) {
    const actual = await source.digestOf(name);
    if (hash.toLowerCase() !== actual) {
      throw new Error(`Digest mismatch for ${name}!\n  Manifest: ${hash}\n  Actual:   ${actual}`);
    }
    console.log(`✅ Verified ${name}`);
  }

  console.log(`\nSuccess: All ${entries.length} entries match the signed manifest.`);
}

validateDigests().catch(err => {
  console.error(`\nValidation Failed: ${err.message}`);
  process.exit(1);
});
