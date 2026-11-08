// The texts of the loaders that tools which build addons write into a package: one arm for each platform that the tool knows, of which one names a file that is there.
export const targets = [
  { platform: "android", arch: "arm64", names: ["android-arm64"] },
  { platform: "win32", arch: "x64", names: ["win32-x64-msvc"] },
  { platform: "win32", arch: "arm64", names: ["win32-arm64-msvc"] },
  { platform: "darwin", arch: "x64", names: ["darwin-x64"] },
  { platform: "darwin", arch: "arm64", names: ["darwin-arm64"] },
  { platform: "freebsd", arch: "x64", names: ["freebsd-x64"] },
  { platform: "linux", arch: "x64", names: ["linux-x64-musl", "linux-x64-gnu"] },
  { platform: "linux", arch: "arm64", names: ["linux-arm64-musl", "linux-arm64-gnu"] },
];

const platforms = [...new Set(targets.map(target => target.platform))];
const isMusl = `function isMusl() {
  const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
  return !report?.header?.glibcVersionRuntime;
}
`;

// A switch over the platform and in it one over the architecture. Each arm asks whether the file lies beside the loader, and requires it or else the package of the platform.
export function loaderWithSwitch(name: string, scope: string) {
  const arm = (target: string, indent: string) =>
    `${indent}isBeside = existsSync(join(__dirname, "${name}.${target}.node"));
${indent}try {
${indent}  if (isBeside) binding = require("./${name}.${target}.node");
${indent}  else binding = require("${scope}/${name}-${target}");
${indent}} catch (error) {
${indent}  loadError = error;
${indent}}
`;
  let text = `const { existsSync } = require("fs");
const { join } = require("path");
const { platform, arch } = process;
let binding = null;
let isBeside = false;
let loadError = null;
${isMusl}
switch (platform) {
`;
  for (const platform of platforms) {
    text += `  case "${platform}":\n    switch (arch) {\n`;
    for (const target of targets.filter(target => target.platform === platform)) {
      text += `      case "${target.arch}":\n`;
      if (target.names.length === 2)
        text += `        if (isMusl()) {\n${arm(target.names[0], "          ")}        } else {\n${arm(target.names[1], "          ")}        }\n`;
      else text += arm(target.names[0], "        ");
      text += `        break;\n`;
    }
    text += `      default:\n        throw new Error("Unsupported architecture on ${platform}: " + arch);\n    }\n    break;\n`;
  }
  text += `  default:
    throw new Error("Unsupported OS: " + platform + ", architecture: " + arch);
}
if (!binding) throw loadError ?? new Error("Failed to load native binding");
const { add } = binding;
module.exports.add = add;
`;
  return text;
}

// A chain of comparisons in a function. Each arm tries the file beside the loader and then the package of the platform, and keeps what either throws.
export function loaderWithChain(name: string, scope: string, { replacesRequire = false } = {}) {
  const arm = (target: string, indent: string) =>
    `${indent}try {
${indent}  return require("./${name}.${target}.node");
${indent}} catch (error) {
${indent}  loadErrors.push(error);
${indent}}
${indent}try {
${indent}  return require("${scope}/${name}-${target}");
${indent}} catch (error) {
${indent}  loadErrors.push(error);
${indent}}
`;
  let text = replacesRequire
    ? `const { createRequire } = require("node:module");\nrequire = createRequire(__filename);\n`
    : "";
  text += `let binding = null;
const loadErrors = [];
${isMusl}
function requireNative() {
  if (process.env.PATH_OF_NATIVE_LIBRARY) {
    try {
      binding = require(process.env.PATH_OF_NATIVE_LIBRARY);
    } catch (error) {
      loadErrors.push(error);
    }
  }`;
  for (const platform of platforms) {
    text += ` else if (process.platform === "${platform}") {\n    `;
    for (const target of targets.filter(target => target.platform === platform)) {
      text += `if (process.arch === "${target.arch}") {\n`;
      if (target.names.length === 2)
        text += `      if (isMusl()) {\n${arm(target.names[0], "        ")}      } else {\n${arm(target.names[1], "        ")}      }\n`;
      else text += arm(target.names[0], "      ");
      text += `    } else `;
    }
    text += `{\n      loadErrors.push(new Error("Unsupported architecture on ${platform}: " + process.arch));\n    }\n  }`;
  }
  text += ` else {
    loadErrors.push(new Error("Unsupported OS: " + process.platform + ", architecture: " + process.arch));
  }
}
binding = requireNative();
if (!binding) throw new Error("Cannot find native binding", { cause: loadErrors });
module.exports = binding;
module.exports.add = binding.add;
`;
  return text;
}

// A table of names under the platform and in it under the architecture. The name that is read out of it is laid into the name of a file beside the loader and into the name of a package.
export function loaderWithTable(name: string, scope: string) {
  let text = `const { existsSync } = require("node:fs");
const path = require("node:path");
const { platform, arch, report } = require("node:process");
const isMusl = () => !report.getReport().header.glibcVersionRuntime;
const namesByPlatformAndArch = {
`;
  for (const platform of platforms) {
    text += `  ${platform}: {\n`;
    for (const target of targets.filter(target => target.platform === platform))
      text +=
        target.names.length === 2
          ? `    ${target.arch}: { base: "${target.names[1]}", musl: "${target.names[0]}" },\n`
          : `    ${target.arch}: { base: "${target.names[0]}" },\n`;
    text += `  },\n`;
  }
  text += `};
function nameOfTarget() {
  const names = namesByPlatformAndArch[platform]?.[arch];
  if (!names) throw new Error("Unsupported: " + platform + " " + arch);
  if ("musl" in names && isMusl()) return names.musl;
  return names.base;
}
const target = nameOfTarget();
const beside = \`./${name}.\${target}.node\`;
const requireOrExplain = id => {
  try {
    return require(id);
  } catch (error) {
    throw new Error("Cannot find module " + id, { cause: error });
  }
};
const { add } = requireOrExplain(existsSync(path.join(__dirname, beside)) ? beside : \`${scope}/${name}-\${target}\`);
module.exports.add = add;
`;
  return text;
}

// A list of names, each tried in a loop until one loads.
export function loaderWithList(name: string, scope: string) {
  return `const { targetOfRuntime } = require("./target");
const target = targetOfRuntime();
const paths = [
  \`../build/Release/${name}-\${target}.node\`,
  \`../build/Release/${name}-wasm32.node\`,
  \`${scope}/${name}-\${target}/${name}.node\`,
  \`${scope}/${name}-wasm32/${name}.node\`,
];
let binding;
const errors = [];
for (const path of paths) {
  try {
    binding = require(path);
    break;
  } catch (error) {
    errors.push(error);
  }
}
if (!binding) throw new Error("Could not load the module for " + target + ": " + errors.map(error => error.code).join(" "));
module.exports = binding;
`;
}
export const targetOfRuntime = `const isMusl = () => process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime;
module.exports.targetOfRuntime = () => \`\${process.platform}\${isMusl() ? "musl" : ""}-\${process.arch}\`;
`;

// A name that grows by a part in one arm of a condition.
export function loaderWithNameThatGrows(name: string, scope: string) {
  return `let name = \`${scope}/${name}-\${process.platform}-\${process.arch}\`;
if (process.platform === "linux") {
  if (!process.report.getReport().header.glibcVersionRuntime) name += "-musl";
  else name += "-glibc";
}
let binding;
try {
  binding = require(name);
} catch (error) {
  try {
    binding = require("./build/Release/${name}.node");
  } catch {
    throw error;
  }
}
module.exports = binding;
`;
}

// The parts of the name are pushed onto a list and joined.
export function loaderWithJoinedParts(name: string) {
  return `const parts = [process.platform, process.arch];
if (process.platform === "linux") {
  if (!process.report.getReport().header.glibcVersionRuntime) parts.push("musl");
  else parts.push("gnu");
} else if (process.platform === "win32") {
  parts.push("msvc");
}
try {
  module.exports = require(\`${name}-\${parts.join("-")}\`);
} catch {
  module.exports = require(\`../${name}.\${parts.join("-")}.node\`);
}
`;
}
