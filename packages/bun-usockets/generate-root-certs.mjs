// Script to update certdata.txt from NSS.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Constants for NSS release metadata.
const kNSSVersion = "version";
const kNSSDate = "date";
const kFirefoxVersion = "firefoxVersion";
const kFirefoxDate = "firefoxDate";

const __filename = fileURLToPath(import.meta.url);
const now = new Date();

const formatDate = d => {
  return d;
};

const getCertdataURL = version => {
  const tag = `NSS_${version.replaceAll(".", "_")}_RTM`;
  const certdataURL = `https://hg.mozilla.org/projects/nss/raw-file/${tag}/lib/ckfw/builtins/certdata.txt`;
  return certdataURL;
};

const normalizeTD = (text = "") => {
  // Remove whitespace and any HTML tags.
  return text?.trim().replace(/<.*?>/g, "");
};
const getReleases = text => {
  const releases = [];
  const tableRE = /<table [^>]+>([\S\s]*?)<\/table>/g;
  const tableRowRE = /<tr ?[^>]*>([\S\s]*?)<\/tr>/g;
  const tableHeaderRE = /<th ?[^>]*>([\S\s]*?)<\/th>/g;
  const tableDataRE = /<td ?[^>]*>([\S\s]*?)<\/td>/g;
  for (const table of text.matchAll(tableRE)) {
    const columns = {};
    const matches = table[1].matchAll(tableRowRE);
    // First row has the table header.
    let row = matches.next();
    if (row.done) {
      continue;
    }
    const headers = Array.from(row.value[1].matchAll(tableHeaderRE), m => m[1]);
    if (headers.length > 0) {
      for (let i = 0; i < headers.length; i++) {
        if (/NSS version/i.test(headers[i])) {
          columns[kNSSVersion] = i;
        } else if (/Release.*from branch/i.test(headers[i])) {
          columns[kNSSDate] = i;
        } else if (/Firefox version/i.test(headers[i])) {
          columns[kFirefoxVersion] = i;
        } else if (/Firefox release date/i.test(headers[i])) {
          columns[kFirefoxDate] = i;
        }
      }
    }
    // Filter out "NSS Certificate bugs" table.
    if (columns[kNSSDate] === undefined) {
      continue;
    }
    // Scrape releases.
    row = matches.next();
    while (!row.done) {
      const cells = Array.from(row.value[1].matchAll(tableDataRE), m => m[1]);
      const release = {};
      release[kNSSVersion] = normalizeTD(cells[columns[kNSSVersion]]);
      release[kNSSDate] = new Date(normalizeTD(cells[columns[kNSSDate]]));
      release[kFirefoxVersion] = normalizeTD(cells[columns[kFirefoxVersion]]);
      release[kFirefoxDate] = new Date(normalizeTD(cells[columns[kFirefoxDate]]));
      if (!isNaN(release[kFirefoxDate]) && isNaN(release[kNSSDate])) {
        release[kNSSDate] = new Date(release[kFirefoxDate]);
      }
      releases.push(release);
      row = matches.next();
    }
  }
  return releases;
};

const getLatestVersion = async releases => {
  const arrayNumberSortDescending = (x, y, i) => {
    if (x[i] === undefined && y[i] === undefined) {
      return 0;
    } else if (x[i] === y[i]) {
      return arrayNumberSortDescending(x, y, i + 1);
    }
    return (y[i] ?? 0) - (x[i] ?? 0);
  };
  const extractVersion = t => {
    return t[kNSSVersion].split(".").map(n => parseInt(n));
  };
  const releaseSorter = (x, y) => {
    return arrayNumberSortDescending(extractVersion(x), extractVersion(y), 0);
  };
  // Return the most recent certadata.txt that exists on the server.
  const sortedReleases = releases.sort(releaseSorter).filter(pastRelease);
  for (const candidate of sortedReleases) {
    const candidateURL = getCertdataURL(candidate[kNSSVersion]);
    if (values.verbose) {
      console.log(`Trying ${candidateURL}`);
    }
    const response = await fetch(candidateURL, { method: "HEAD" });
    if (response.ok) {
      return candidate[kNSSVersion];
    }
  }
};

const pastRelease = r => {
  return r[kNSSDate] < now;
};

const options = {
  help: {
    type: "boolean",
  },
  file: {
    short: "f",
    type: "string",
  },
  verbose: {
    short: "v",
    type: "boolean",
  },
};
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options,
});

if (values.help) {
  console.log(`Usage: ${basename(__filename)} [OPTION]... [VERSION]...`);
  console.log();
  console.log("Updates certdata.txt to NSS VERSION (most recent release by default).");
  console.log("");
  console.log("  -f, --file=FILE  writes a commit message reflecting the change to the");
  console.log("                     specified FILE");
  console.log("  -v, --verbose    writes progress to stdout");
  console.log("      --help       display this help and exit");
  process.exit(0);
}

const versions = await fetch("https://nucleus.mozilla.org/rna/all-releases.json").then(res => res.json());

const today = new Date().toISOString().split("T")[0].trim();
const releases = versions
  .filter(
    version =>
      version.channel == "Release" &&
      version.product === "Firefox" &&
      version.is_public &&
      version.release_date <= today,
  )
  .sort((a, b) => (a > b ? (a == b ? 0 : -1) : 1));
const latest = releases[0];
const release_tag = `FIREFOX_${latest.version.replaceAll(".", "_")}_RELEASE`;
if (values.verbose) {
  console.log(`Fetching NSS release from ${release_tag}`);
}
const version = await fetch(
  `https://hg.mozilla.org/releases/mozilla-release/raw-file/${release_tag}/security/nss/TAG-INFO`,
)
  .then(res => res.text())
  .then(txt => txt.trim().split("NSS_")[1].split("_RTM").join("").split("_").join(".").trim());

const release = {
  version: version,
  firefoxVersion: latest.version,
  firefoxDate: latest.release_date,
  date: latest.release_date,
};
if (values.verbose) {
  console.log("Found NSS version:");
  console.log(release);
}

// Fetch certdata.txt and overwrite the local copy.
const certdataURL = getCertdataURL(version);
if (values.verbose) {
  console.log(`Fetching ${certdataURL}`);
}

const checkoutDir = dirname(__filename);
const certdata = await fetch(certdataURL);
const certdataFile = join(checkoutDir, "certdata.txt");
if (!certdata.ok) {
  console.error(`Failed to fetch ${certdataURL}: ${certdata.status}: ${certdata.statusText}`);
  process.exit(-1);
}
if (values.verbose) {
  console.log(`Writing ${certdataFile}`);
}
await pipeline(certdata.body, createWriteStream(certdataFile));

// Run generate-root-certs.pl to generate src/crypto/root_certs.h.
if (values.verbose) {
  console.log("Running generate-root-certs.pl");
}
const opts = { encoding: "utf8" };
const mkCABundleTool = join(checkoutDir, "generate-root-certs.pl");
const mkCABundleOut = execFileSync(mkCABundleTool, values.verbose ? ["-v"] : [], opts);
if (values.verbose) {
  console.log(mkCABundleOut);
}

// Determine certificates added and/or removed.
const certHeaderFile = relative(process.cwd(), join(checkoutDir, "src", "crypto", "root_certs.h"));
const diff = execFileSync("git", ["diff-files", "-u", "--", certHeaderFile], opts);
if (values.verbose) {
  console.log(diff);
}
const certsAddedRE = /^\+\/\* (.*) \*\//gm;
const certsRemovedRE = /^-\/\* (.*) \*\//gm;
const added = [...diff.matchAll(certsAddedRE)].map(m => m[1]);
const removed = [...diff.matchAll(certsRemovedRE)].map(m => m[1]);

const commitMsg = [
  `crypto: update root certificates to NSS ${release[kNSSVersion]}`,
  "",
  `This is the certdata.txt[0] from NSS ${release[kNSSVersion]}, released on ${formatDate(release[kNSSDate])}.`,
  "",
  `This is the version of NSS that ${release[kFirefoxDate] < now ? "shipped" : "will ship"} in Firefox ${
    release[kFirefoxVersion]
  } on`,
  `${formatDate(release[kFirefoxDate])}.`,
  "",
];
if (added.length > 0) {
  commitMsg.push("Certificates added:");
  commitMsg.push(...added.map(cert => `- ${cert}`));
  commitMsg.push("");
}
if (removed.length > 0) {
  commitMsg.push("Certificates removed:");
  commitMsg.push(...removed.map(cert => `- ${cert}`));
  commitMsg.push("");
}
commitMsg.push(`[0] ${certdataURL}`);
const delimiter = randomUUID();
const properties = [
  `NEW_VERSION=${release[kNSSVersion]}`,
  `COMMIT_MSG<<${delimiter}`,
  ...commitMsg,
  delimiter,
  "",
].join("\n");
if (values.verbose) {
  console.log(properties);
}
const propertyFile = values.file;
if (propertyFile !== undefined) {
  console.log(`Writing to ${propertyFile}`);
  await pipeline(Readable.from(properties), createWriteStream(propertyFile));
}
