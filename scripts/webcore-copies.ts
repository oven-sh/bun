#!/usr/bin/env bun
/**
 * Lists the upstream WebKit commits that touch a file Bun keeps its own copy
 * of.
 *
 *   bun scripts/webcore-copies.ts <old-base> <new-base>
 *
 * Both are revisions in the WebKit clone ($BUN_WEBKIT_PATH, else vendor/WebKit):
 * the upstream commit the fork was merged with before, and the one it is
 * merged with now. The clone needs the history between the two. One made with
 * `--filter=blob:none` fetches each file that is compared.
 *
 * Bun does not build Source/WebCore. The files under src/jsc/bindings that
 * come from it (most of them in webcore/ and webcrypto/) were copied by hand
 * and edited to run outside a browser. Merging upstream into the fork does not
 * change them, so an upstream fix reaches a copy only when someone ports it.
 * .claude/commands/upgrade-webkit.md says what to do with the list.
 *
 * Changes to upstream's implementation of streams are not listed:
 * src/jsc/bindings/webcore/streams is Bun's own. A changed .idl of a stream
 * class is listed, like every .idl that Bun has a binding for.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const copiesRoot = "src/jsc/bindings";
const upstreamRoot = "Source/WebCore";
/** The remote of the clone that is WebKit/WebKit. The upgrade routine asks for this name. */
const upstreamRemote = "upstream";

/**
 * The upstream files of a copy that its file name does not lead to: Bun's
 * file, then each such upstream file. An upstream file with the name of the
 * copy is found without an entry.
 *
 * Add an upstream file here when upstream moves code of a copy into it (it
 * renames the copy's file, or splits it), and when WebCore code goes into a
 * Bun file of another name. The script fails when upstream no longer has a
 * file that is named here, so that an entry cannot stop matching without
 * notice.
 */
export const upstreamOf: Record<string, string[]> = {
  // Upstream moved much of structured clone into JavaScriptCore. Bun's copy still has it in one file.
  "src/jsc/bindings/webcore/SerializedScriptValue.cpp": [
    "Source/JavaScriptCore/runtime/CloneBase.h",
    "Source/JavaScriptCore/runtime/CloneSerializerBase.h",
    "Source/JavaScriptCore/runtime/CloneDeserializerBase.h",
    "Source/JavaScriptCore/runtime/StructuredCloneTags.h",
    "Source/JavaScriptCore/runtime/StructuredCloneTags.cpp",
  ],
  // Upstream split the inline functions off.
  "src/jsc/bindings/webcore/EventTarget.h": ["Source/WebCore/dom/EventTargetInlines.h"],
  "src/jsc/bindings/webcore/JSValueInWrappedObject.h": ["Source/WebCore/bindings/js/JSValueInWrappedObjectInlines.h"],
  // The OpenSSL half is in a file of its own upstream. Bun wrote its half into the algorithm's file.
  "src/jsc/bindings/webcrypto/CryptoAlgorithmEd25519.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmEd25519OpenSSL.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmX25519.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmX25519OpenSSL.cpp",
  ],
  // Made from the Cocoa file, before upstream had an OpenSSL one.
  "src/jsc/bindings/webcrypto/CryptoKeyOKPOpenSSL.cpp": ["Source/WebCore/crypto/cocoa/CryptoKeyOKPCocoa.cpp"],
  // Upstream took the underscore out of these names.
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CBC.h": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCBC.h"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CBC.cpp": [
    "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCBC.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CBCOpenSSL.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmAESCBCOpenSSL.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CFB.h": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCFB.h"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CFB.cpp": [
    "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCFB.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CFBOpenSSL.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmAESCFBOpenSSL.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CTR.h": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCTR.h"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CTR.cpp": [
    "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESCTR.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_CTROpenSSL.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmAESCTROpenSSL.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_GCM.h": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESGCM.h"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_GCM.cpp": [
    "Source/WebCore/crypto/algorithms/CryptoAlgorithmAESGCM.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_GCMOpenSSL.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmAESGCMOpenSSL.cpp",
  ],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KW.h": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.h"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KW.cpp": ["Source/WebCore/crypto/algorithms/CryptoAlgorithmAESKW.cpp"],
  "src/jsc/bindings/webcrypto/CryptoAlgorithmAES_KWOpenSSL.cpp": [
    "Source/WebCore/crypto/openssl/CryptoAlgorithmAESKWOpenSSL.cpp",
  ],
  // WebCore code in a file with a name of Bun's.
  "src/jsc/bindings/webcore/CustomEventCustom.cpp": ["Source/WebCore/bindings/js/JSCustomEventCustom.cpp"],
  "src/jsc/bindings/webcrypto/CryptoDigest.cpp": ["Source/WebCore/PAL/pal/crypto/openssl/CryptoDigestOpenSSL.cpp"],
  "src/jsc/bindings/BunClientData.h": ["Source/WebCore/bindings/js/WebCoreJSClientData.h"],
  "src/jsc/bindings/BunClientData.cpp": ["Source/WebCore/bindings/js/WebCoreJSClientData.cpp"],
  "src/jsc/bindings/BunGCOutputConstraint.h": ["Source/WebCore/bindings/js/DOMGCOutputConstraint.h"],
  "src/jsc/bindings/BunGCOutputConstraint.cpp": ["Source/WebCore/bindings/js/DOMGCOutputConstraint.cpp"],
  "src/jsc/bindings/BunInjectedScriptHost.h": ["Source/WebCore/inspector/WebInjectedScriptHost.h"],
  "src/jsc/bindings/BunInjectedScriptHost.cpp": ["Source/WebCore/inspector/WebInjectedScriptHost.cpp"],
  "src/jsc/bindings/DOMWrapperWorld-class.h": ["Source/WebCore/bindings/js/DOMWrapperWorld.h"],
  "src/jsc/bindings/ZigGlobalObject.h": ["Source/WebCore/bindings/js/JSDOMGlobalObject.h"],
  "src/jsc/bindings/ZigGlobalObject.cpp": ["Source/WebCore/bindings/js/JSDOMGlobalObject.cpp"],
  // node:events on the listener code of EventTarget.
  "src/jsc/bindings/webcore/EventEmitter.cpp": ["Source/WebCore/dom/EventTarget.cpp"],
  "src/jsc/bindings/webcore/JSEventEmitterCustom.h": ["Source/WebCore/bindings/js/JSEventTargetCustom.h"],
  "src/jsc/bindings/webcore/IdentifierEventListenerMap.cpp": ["Source/WebCore/dom/EventListenerMap.cpp"],
  "src/jsc/bindings/webcore/IdentifierEventListenerMap.h": [
    "Source/WebCore/dom/EventListenerMap.h",
    "Source/WebCore/dom/RegisteredEventListener.h",
  ],
};

export interface ChangedFile {
  /** Path in WebKit. */
  upstream: string;
  /** The new base does not have it: the range deleted it, or moved it. */
  gone: boolean;
  /** Bun's copies of it, each with `compareToUpstream`'s share. */
  copies: { path: string; share: number | undefined }[];
  /** Bun's `JS<Name>.cpp`, when `upstream` is `<Name>.idl`. */
  binding: string | undefined;
}

export interface UpstreamCommit {
  sha: string;
  date: string;
  title: string;
  files: ChangedFile[];
}

export interface CopyChanges {
  /** Newest first. */
  commits: UpstreamCommit[];
  /** How many commits the range has, listed or not. */
  total: number;
}

/** What the command prints without a stack trace. */
class Failure extends Error {}

function git(cwd: string, ...args: string[]): string {
  // Without the option, git prints a path that is not ASCII in quotes, with its bytes as numbers.
  const cmd = ["git", "-c", "core.quotePath=false", ...args];
  const { exitCode, stdout, stderr } = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0) throw new Failure(`\`git ${args.join(" ")}\` failed in ${cwd}:\n${stderr}`);
  return stdout.toString();
}

const trimmedLines = (text: string) =>
  text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");

/**
 * Whether `copy` still has text of `upstream`, and how much of it.
 *
 * Two files with the same name are not always related: Bun's Path.cpp is
 * node:path, WebCore's draws curves. `isCopy` asks for one shared line of 40
 * characters or more. The license header of a real copy has several, and
 * `#pragma once`, `namespace WebCore {` or `#include "config.h"` are shorter.
 *
 * `share` is the part of the upstream file's code that the copy has too, where
 * code is every line of 16 characters or more outside a comment (so not a
 * brace, `return true;` or the license). It says how well a diff of the
 * upstream file lines up with the copy. It is low when Bun has few of the
 * file's functions and when either side has edited them, so a low share does
 * not mean that a fix has nothing to apply to. It is undefined for an upstream
 * file with fewer than 8 lines of code, where one edited line decides it.
 */
export function compareToUpstream(copy: string, upstream: string): { isCopy: boolean; share: number | undefined } {
  const ours = new Set(trimmedLines(copy));
  const code = trimmedLines(upstream.replace(/\/\*[\s\S]*?\*\//g, "")).filter(
    line => line.length >= 16 && !line.startsWith("//"),
  );
  return {
    isCopy: trimmedLines(upstream).some(line => line.length >= 40 && ours.has(line)),
    share: code.length >= 8 ? code.filter(line => ours.has(line)).length / code.length : undefined,
  };
}

/**
 * The commits in `oldBase..newBase` of the WebKit clone at `webkitRoot` that
 * touch an upstream file with a counterpart among the tracked files under
 * src/jsc/bindings of the bun checkout at `bunRoot`. A counterpart is:
 * - a file of the same name that `compareToUpstream` takes for a copy,
 * - a copy that `table` names for the file,
 * - for `<Name>.idl`, the binding `JS<Name>.cpp`. WebCore generates that file
 *   from the IDL, and Bun's is kept by hand.
 */
export function listCopyChanges(
  bunRoot: string,
  webkitRoot: string,
  oldBase: string,
  newBase: string,
  table = upstreamOf,
): CopyChanges {
  const range = `${oldBase}..${newBase}`;
  const total = Number(git(webkitRoot, "rev-list", "--count", range));
  if (total === 0) throw new Failure(`No commit is in ${range}. Is the old base the older of the two?`);

  const tracked = trimmedLines(git(bunRoot, "ls-files", "--", copiesRoot));
  const missing = tracked.filter(path => !existsSync(join(bunRoot, path)));
  if (missing.length > 0) {
    throw new Failure(`These tracked files are not in the working tree of ${bunRoot}:\n  ${missing.join("\n  ")}`);
  }
  const ours = (path: string) => readFileSync(join(bunRoot, path), "utf8");
  const byName = Map.groupBy(tracked, path => basename(path));

  // `table` the other way round.
  const namedCopies = new Map<string, string[]>();
  for (const [copy, upstream] of Object.entries(table)) {
    for (const path of upstream) namedCopies.set(path, [...(namedCopies.get(path) ?? []), copy]);
  }
  const outsideRoot = [...namedCopies.keys()].filter(path => !path.startsWith(`${upstreamRoot}/`));

  // Which upstream files each end has. A failed read of one of them is then an error, not a file that is not there.
  const filesAt = (rev: string) =>
    new Set(trimmedLines(git(webkitRoot, "ls-tree", "-r", "--name-only", rev, "--", upstreamRoot, ...outsideRoot)));
  const atOld = filesAt(oldBase);
  const atNew = filesAt(newBase);
  const commitsWith = (path: string, ...revisions: string[]) =>
    trimmedLines(git(webkitRoot, "rev-list", ...revisions, "--", path));

  // An entry that matches nothing must not go unseen. A file that the old base does not have is fine only when an
  // upstream commit that comes after the old base has it: one in the range, or a later one on a branch of the
  // upstream remote. A commit of the fork does not count. Neither does one on a branch that left before the old
  // base, such as a release branch.
  const wrong = Object.keys(table)
    .filter(copy => !tracked.includes(copy))
    .map(copy => `${copy} is not a tracked file.`);
  const after = [newBase, `--remotes=${upstreamRemote}`, "--ancestry-path", `^${oldBase}`];
  for (const path of namedCopies.keys()) {
    if (atOld.has(path) || commitsWith(path, "-1", ...after).length > 0) continue;
    const [removal] = commitsWith(path, "-1", oldBase);
    wrong.push(
      removal === undefined
        ? `${path} is not in the history of ${oldBase}, and no later upstream commit has it.`
        : `${path} is gone since ${removal.slice(0, 12)}. Name the file that has its code now, or take it out.`,
    );
  }
  if (wrong.length > 0) throw new Failure(`\`upstreamOf\` in scripts/webcore-copies.ts:\n  ${wrong.join("\n  ")}`);

  // A copy is held against the text that the commits of the range change: the file as the old base has it, or as the
  // first commit of the range that has it.
  const texts = new Map<string, string>();
  const theirs = (path: string) => {
    if (!texts.has(path)) {
      const [revision] = atOld.has(path) ? [oldBase] : commitsWith(path, "--reverse", range);
      texts.set(path, git(webkitRoot, "show", `${revision}:${path}`));
    }
    return texts.get(path)!;
  };

  const changedFile = (upstream: string): ChangedFile | undefined => {
    const named = namedCopies.get(upstream) ?? [];
    const sameName = (byName.get(basename(upstream)) ?? []).filter(path => !named.includes(path));
    const copies: ChangedFile["copies"] = [];
    for (const path of [...named, ...sameName]) {
      const { isCopy, share } = compareToUpstream(ours(path), theirs(upstream));
      // The table says that a file it names is a copy. A file of the same name must show it.
      if (isCopy || named.includes(path)) copies.push({ path, share });
    }
    const idl = basename(upstream).endsWith(".idl") ? basename(upstream).slice(0, -".idl".length) : undefined;
    const binding = idl === undefined ? undefined : byName.get(`JS${idl}.cpp`)?.[0];
    if (copies.length === 0 && binding === undefined) return undefined;
    return { upstream, gone: !atNew.has(upstream), copies, binding };
  };

  // Per commit: \0 <sha> \0 <date> \0 <message> \0, then one path per line.
  // --no-renames lists a moved file under both of its paths.
  const format = "--format=%x00%h%x00%cs%x00%B%x00";
  const log = git(webkitRoot, "log", "--no-renames", "--name-only", format, range, "--", upstreamRoot, ...outsideRoot);
  const fields = log.split("\0");
  const commits: UpstreamCommit[] = [];
  for (let i = 1; i + 3 < fields.length; i += 4) {
    const [sha, date, message, paths] = fields.slice(i, i + 4);
    const files = trimmedLines(paths)
      .map(changedFile)
      .filter(file => file !== undefined);
    if (files.length > 0) commits.push({ sha, date, title: message.split("\n")[0], files });
  }
  return { commits, total };
}

export function formatCopyChanges({ commits, total }: CopyChanges, range: string): string {
  const lines: string[] = [];
  for (const { sha, date, title, files } of commits) {
    lines.push(`${sha} ${date} ${title}`);
    for (const { upstream, gone, copies, binding } of files) {
      const counterparts = copies.map(({ path, share }) =>
        share === undefined ? path : `${path} (${Math.round(share * 100)}% same)`,
      );
      if (binding !== undefined) counterparts.push(`${binding} (binding)`);
      lines.push(`    ${upstream}${gone ? " (gone)" : ""} -> ${counterparts.join(", ")}`);
    }
  }
  if (commits.length > 0) lines.push("");
  lines.push(`Commits in ${range} that touch the upstream file of a Bun copy: ${commits.length} of ${total}`);
  return lines.join("\n");
}

/** The command: what it prints for `args`, and its exit code. */
export function main(args: string[], bunRoot: string, webkitRoot: string) {
  const [oldBase, newBase] = args;
  if (!oldBase || !newBase || !existsSync(webkitRoot)) {
    const usage = "usage: bun scripts/webcore-copies.ts <old-base> <new-base>";
    const clone = `It reads the WebKit clone at ${webkitRoot}. Set BUN_WEBKIT_PATH to use another one.`;
    return { exitCode: 1, stdout: "", stderr: `${usage}\n${clone}` };
  }
  try {
    const changes = listCopyChanges(bunRoot, webkitRoot, oldBase, newBase);
    return { exitCode: 0, stdout: formatCopyChanges(changes, `${oldBase}..${newBase}`), stderr: "" };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    return { exitCode: 1, stdout: "", stderr: error.message };
  }
}

if (import.meta.main) {
  const bunRoot = dirname(import.meta.dir);
  const webkitRoot = process.env.BUN_WEBKIT_PATH || join(bunRoot, "vendor", "WebKit");
  const { exitCode, stdout, stderr } = main(process.argv.slice(2), bunRoot, webkitRoot);
  if (stdout !== "") console.log(stdout);
  if (stderr !== "") console.error(stderr);
  process.exitCode = exitCode;
}
