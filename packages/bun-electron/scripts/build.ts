// Builds the native shim + helper and assembles the runtime layout in
// dist/<platform>-<arch>/ (shim, helper, CEF binaries and resources).
//
//   bun scripts/build.ts [--debug] [--cef-root=/path/to/cef]

import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fetchCef, cefRoot } from "./fetch-cef";

const PKG_ROOT = path.join(import.meta.dir, "..");
const NATIVE_DIR = path.join(PKG_ROOT, "native");

const debug = process.argv.includes("--debug");
const cefRootArg = process.argv.find((a) => a.startsWith("--cef-root="))?.slice("--cef-root=".length);

function run(cmd: string[], cwd?: string): Promise<void> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn({ cmd, cwd, stdout: "inherit", stderr: "inherit" });
  return proc.exited.then((code) => {
    if (code !== 0) throw new Error(`${cmd[0]} exited with code ${code}`);
  });
}

async function hasCommand(name: string): Promise<boolean> {
  return Bun.which(name) !== null;
}

function distDir(): string {
  const platform =
    process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return path.join(PKG_ROOT, "dist", `${platform}-${arch}`);
}

function macHelperPlist(name: string, bundleId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSEnvironment</key><dict><key>MallocNanoZone</key><string>0</string></dict>
  <key>LSFileQuarantineEnabled</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><string>1</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
`;
}

async function main() {
  const cef = cefRootArg ?? (existsSync(path.join(cefRoot(), "cmake")) ? cefRoot() : await fetchCef());
  const buildDir = path.join(NATIVE_DIR, "build");
  const buildType = debug ? "Debug" : "Release";

  const generator = (await hasCommand("ninja")) ? ["-G", "Ninja"] : [];
  await run([
    "cmake",
    ...generator,
    `-DCMAKE_BUILD_TYPE=${buildType}`,
    `-DCEF_ROOT=${cef}`,
    "-B",
    buildDir,
    "-S",
    NATIVE_DIR,
  ]);
  await run(["cmake", "--build", buildDir, "--config", buildType, "--parallel"]);

  // Assemble dist/.
  const dist = distDir();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const cefBin = path.join(cef, buildType === "Debug" ? "Debug" : "Release");
  const cefRes = path.join(cef, "Resources");
  // Multi-config generators (VS, Xcode) nest outputs under the config name.
  const builtDir = existsSync(path.join(buildDir, buildType)) ? path.join(buildDir, buildType) : buildDir;

  if (process.platform === "linux") {
    await cp(path.join(builtDir, "libbun_electron_shim.so"), path.join(dist, "libbun_electron_shim.so"));
    await cp(path.join(builtDir, "bun-electron-helper"), path.join(dist, "bun-electron-helper"));
    await cp(cefBin, dist, { recursive: true }); // libcef.so, libEGL, snapshots, ...
    await cp(cefRes, dist, { recursive: true }); // icudtl.dat, *.pak, locales/
    await chmod(path.join(dist, "bun-electron-helper"), 0o755);
  } else if (process.platform === "win32") {
    await cp(path.join(builtDir, "bun_electron_shim.dll"), path.join(dist, "bun_electron_shim.dll"));
    await cp(path.join(builtDir, "bun-electron-helper.exe"), path.join(dist, "bun-electron-helper.exe"));
    await cp(cefBin, dist, { recursive: true });
    await cp(cefRes, dist, { recursive: true });
  } else if (process.platform === "darwin") {
    await cp(path.join(builtDir, "libbun_electron_shim.dylib"), path.join(dist, "libbun_electron_shim.dylib"));
    // The framework bundle ships in <cef>/Release regardless of build type.
    await cp(
      path.join(cef, "Release", "Chromium Embedded Framework.framework"),
      path.join(dist, "Chromium Embedded Framework.framework"),
      { recursive: true },
    );
    // CEF/Chromium derives helper-variant paths from the main helper's name:
    // "<name> (GPU).app" etc. next to "<name>.app".
    const helperSrc = path.join(builtDir, "bun-electron-helper");
    const variants = ["", " (GPU)", " (Renderer)", " (Plugin)", " (Alerts)"];
    for (const variant of variants) {
      const name = `bun-electron Helper${variant}`;
      const appDir = path.join(dist, `${name}.app`, "Contents");
      await mkdir(path.join(appDir, "MacOS"), { recursive: true });
      const idSuffix = variant
        ? `.helper.${variant.replace(/[ ()]/g, "").toLowerCase()}`
        : ".helper";
      await writeFile(
        path.join(appDir, "Info.plist"),
        macHelperPlist(name, `com.bun.bun-electron${idSuffix}`),
      );
      await cp(helperSrc, path.join(appDir, "MacOS", name));
      await chmod(path.join(appDir, "MacOS", name), 0o755);
    }
  }

  console.log(`\nbun-electron dist ready: ${dist}`);
}

await main();
