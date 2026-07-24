// Cross-compilation toolchains + sysroots. Only the build host image carries
// these (it cross-compiles every target); every component here yields no
// steps and declares no artifacts on any other image. The few genuine
// scripts (sysroot assembly, symlink rewriting, runtime path discovery) use
// ops.shellScript() with a required description, so they read as labeled
// exceptions.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Download } from "../../artifacts.ts";
import {
  androidNdkDownload,
  freebsdBaseDownload,
  gcc13FocalDebsDownload,
  ubuntuPackagesGzUrl,
  xwinDownload,
} from "../../artifacts.ts";
import {
  ensureDirectory,
  ensureSymlink,
  extractArchive,
  moveFile,
  removePaths,
  setModeRecursive,
  shellScript,
  verify,
} from "../../ops-posix.ts";
import { download, log, run, scratchDir, sudo, warn } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { appendToProfiles } from "../environment.ts";
import { linuxBin, linuxOpt } from "../paths.ts";

/** Cross-arch GNU strip for -R .eh_frame (host strip rejects foreign-arch
 * ELF) + amd64 compiler-rt for x64 asan cross-links. */
export const crossBinutils: LinuxComponent = {
  name: "cross-binutils",
  artifacts: () => ({}),
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    return [
      {
        name: "Install cross binutils + amd64 compiler-rt",
        run: async () => {
          await ctx.manager.install(ctx, cross.crossBinutils);
          // x64 asan cross needs amd64 compiler-rt. Best-effort: apt.llvm.org
          // may not carry amd64 on every arm64 repo.
          await sudo(["dpkg", "--add-architecture", "amd64"], { allowFailure: true });
          await sudo(["apt-get", "update", "-qq"], {
            allowFailure: true,
            env: { DEBIAN_FRONTEND: "noninteractive" },
          });
          const result = await sudo(
            ["apt-get", "install", "--yes", "--no-install-recommends", `libclang-rt-${image.llvm.major}-dev:amd64`],
            { allowFailure: true, env: { DEBIAN_FRONTEND: "noninteractive" } },
          );
          if (result.exitCode !== 0)
            warn("amd64 compiler-rt unavailable from apt.llvm.org; x64 asan cross-links may fail");
        },
      },
    ];
  },
};

/** Android NDK: its sysroot + android compiler-rt, symlinked into the host
 * clang's resource dir. */
export const androidNdk: LinuxComponent = {
  name: "android-ndk",
  artifacts: image => (image.buildHost ? { androidNdk: androidNdkDownload(image.crossToolchains) } : {}),
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    const ndk = cross.androidNdk;
    return [
      {
        name: `Install Android NDK ${ndk.version}`,
        run: async () => {
          if (existsSync(ndk.path)) {
            log(`${ndk.path} already exists; reusing`);
          } else {
            const zip = await download(artifact(ctx.artifacts, "androidNdk"));
            await extractArchive({ file: zip, into: image.paths.opt, root: true });
            await moveFile(linuxOpt(image, `android-ndk-${ndk.version}`), ndk.path);
            // Trim ~1.1GB we don't use (NDK's own clang/lld, lldb, non-android
            // runtimes) — we only need sysroot + android compiler-rt.
            const prebuilt = `${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64`;
            await removePaths(
              `${prebuilt}/bin`,
              `${prebuilt}/python3`,
              `${prebuilt}/lib/liblldb.so`,
              `${ndk.path}/simpleperf`,
              `${ndk.path}/shader-tools`,
              `${ndk.path}/sources`,
            );
            await appendToProfiles(ctx, [`export ANDROID_NDK_ROOT=${ndk.path}`]);
          }
          // clang's driver hardcodes <resource-dir>/lib/<triple>/libclang_rt.*
          // with no -L fallback, so the file must exist there for any android
          // link. Done as root so the build user needs no write access to /usr.
          // Both dirs are discovered at run time (they exist only after extraction
          // and the LLVM install), hence a script.
          await shellScript({
            describe:
              "symlink NDK compiler-rt builtins + libunwind into the host clang resource dir (flat + per-triple layouts)",
            root: true,
            script: `set -e
CLANG="$(command -v clang-${image.llvm.major} || command -v clang)"
RES="$($CLANG -print-resource-dir)"
NDK_CLANG_VER="$(ls "${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/" | head -1)"
NDK_RT="${ndk.path}/toolchains/llvm/prebuilt/linux-x86_64/lib/clang/$NDK_CLANG_VER/lib/linux"
echo "clang resource dir: $RES"
echo "NDK clang runtime: $NDK_RT"
mkdir -p "$RES/lib/linux"
for A in aarch64 x86_64; do
ln -sfv "$NDK_RT/libclang_rt.builtins-$A-android.a" "$RES/lib/linux/"
mkdir -p "$RES/lib/linux/$A"
ln -sfv "$NDK_RT/$A/libunwind.a" "$RES/lib/linux/$A/"
T="$RES/lib/$A-unknown-linux-android28"
mkdir -p "$T"
ln -sfv "$NDK_RT/libclang_rt.builtins-$A-android.a" "$T/libclang_rt.builtins.a"
ln -sfv "$NDK_RT/$A/libunwind.a" "$T/libunwind.a"
done`,
          });
        },
      },
    ];
  },
};

/** FreeBSD sysroots (amd64 + arm64) from the release base.txz. */
export const freebsdSysroot: LinuxComponent = {
  name: "freebsd-sysroot",
  artifacts: image =>
    image.buildHost
      ? {
          "freebsdBase-amd64": freebsdBaseDownload(image.crossToolchains, "amd64"),
          "freebsdBase-arm64": freebsdBaseDownload(image.crossToolchains, "arm64"),
        }
      : {},
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    return [
      {
        name: `Install FreeBSD ${cross.freebsdSysroot.version} sysroots (amd64, arm64)`,
        run: async () => {
          for (const fbsdArch of ["amd64", "arm64"] as const) {
            const sysroot = cross.freebsdSysroot.paths[fbsdArch];
            // Same sentinel detectFreebsdSysroot() uses, plus a /lib file so a
            // half-extracted (interrupted) sysroot isn't treated as complete.
            if (existsSync(`${sysroot}/usr/include/sys/param.h`) && existsSync(`${sysroot}/lib/libc.so.7`)) {
              log(`${sysroot} already complete; reusing`);
              continue;
            }
            await removePaths(sysroot);
            await ensureDirectory(sysroot);
            const baseTxz = await download(artifact(ctx.artifacts, `freebsdBase-${fbsdArch}`), {
              name: `freebsd-${fbsdArch}-base.txz`,
            });
            await extractArchive({
              file: baseTxz,
              into: sysroot,
              members: ["./usr/include", "./usr/lib", "./lib"],
              root: true,
            });
          }
          // No FREEBSD_SYSROOT export — detectFreebsdSysroot() picks the
          // arch-appropriate path by well-known location.
        },
      },
    ];
  },
};

/** linux-gnu sysroots: ubuntu:20.04 (glibc 2.31) + gcc-13 libstdc++,
 * matching the environment prebuilt WebKit is compiled in. */
export const glibcSysroot: LinuxComponent = {
  name: "glibc-sysroot",
  artifacts: image => {
    if (!image.buildHost) return {};
    const cross = image.crossToolchains;
    const bundle: { [name: string]: Download } = {
      "gcc13FocalDebs-amd64": gcc13FocalDebsDownload(cross, "amd64"),
      "gcc13FocalDebs-arm64": gcc13FocalDebsDownload(cross, "arm64"),
    };
    // Ubuntu focal Packages indexes per sysroot arch, in dist order.
    for (const srArch of ["x86_64", "aarch64"] as const) {
      for (const [i, dist] of cross.glibcSysroot.dists.entries()) {
        bundle[`ubuntuPackagesGz-${srArch}-${i}`] = { url: ubuntuPackagesGzUrl(cross, srArch, dist), sha256: null };
      }
    }
    return bundle;
  },
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    const g = cross.glibcSysroot;
    return [
      {
        name: `Install linux-gnu sysroots (ubuntu 20.04 / glibc ${g.glibcVersion} + gcc-13)`,
        run: async () => {
          for (const srArch of ["x86_64", "aarch64"] as const) {
            const sysroot = g.paths[srArch];
            const debArch = srArch === "x86_64" ? "amd64" : "arm64";
            const triple = `${srArch}-linux-gnu`;
            if (existsSync(`${sysroot}/usr/include/features.h`) && existsSync(`${sysroot}/usr/include/c++/13`)) {
              log(`${sysroot} already complete; reusing`);
              continue;
            }
            await removePaths(sysroot);
            await ensureDirectory(sysroot);
            // Inputs fetched up front (logged, checksummed where pinned); the
            // assembly below is one script because each stage feeds the next.
            const packagesFiles: string[] = [];
            for (const [i] of g.dists.entries()) {
              packagesFiles.push(
                await download(artifact(ctx.artifacts, `ubuntuPackagesGz-${srArch}-${i}`), {
                  name: `Packages-${srArch}-${i}.gz`,
                }),
              );
            }
            const gcc13 = await download(artifact(ctx.artifacts, `gcc13FocalDebs-${debArch}`));
            const lib64 =
              srArch === "x86_64"
                ? `if [ ! -e '${sysroot}/lib64' ]; then ln -sfn 'usr/lib/${triple}' '${sysroot}/lib64'; fi`
                : "true";
            await shellScript({
              describe:
                `assemble ${sysroot}: ubuntu:20.04 rootfs layers via skopeo, focal libc dev debs resolved ` +
                `from the Packages index, symlinks rewritten to stay inside the sysroot, gcc-13 libstdc++ overlaid`,
              root: true,
              script: `set -ex
tmp="$(mktemp -d)"
# 1. ubuntu:20.04 rootfs (glibc 2.31 runtime libs). Raw tar: mknod failures
#    on /dev nodes must not abort; the libc6 deb below provides what we need.
skopeo copy --override-arch ${debArch} docker://${g.ubuntuImage} dir:$tmp/img
for d in $(jq -r '.layers[].digest' $tmp/img/manifest.json | sed 's/^sha256://'); do
tar -xzf "$tmp/img/$d" -C '${sysroot}' 2>/dev/null || true
done
# 2. focal runtime + dev headers: resolve each package's .deb path from the
#    Packages index (focal-updates listed first so first-match is patched).
gzip -dc ${packagesFiles.map(f => `'${f}'`).join(" ")} > $tmp/Packages
for pkg in ${g.packages.join(" ")}; do
path=$(awk -v p="$pkg" '$1=="Package:"&&$2==p{f=1} f&&$1=="Filename:"{print $2; exit}' $tmp/Packages)
if [ -z "$path" ]; then echo "package $pkg not found in focal Packages index" >&2; exit 1; fi
curl -fsSL "${g.aptBase[srArch]}/$path" -o "$tmp/$pkg.deb"
dpkg-deb -x "$tmp/$pkg.deb" '${sysroot}'
done
# 3. Absolute symlinks from the debs point at host paths; rewrite them to
#    stay inside the sysroot so -lpthread/-ldl resolve to target libs.
find '${sysroot}' -type l 2>/dev/null | while read -r l; do
t="$(readlink "$l")"
case "$t" in /*) ln -sfn "${sysroot}$t" "$l" ;; esac
done
# libc.so's linker script uses absolute /lib/<triple>/ paths; make them
# resolve inside the sysroot (usrmerge-style symlink if missing).
if [ ! -e '${sysroot}/lib/${triple}/libc.so.6' ]; then
mkdir -p '${sysroot}/lib'
ln -sfn '../usr/lib/${triple}' '${sysroot}/lib/${triple}'
fi
${lib64}
# 4. gcc-13 (libstdc++-13-dev, libgcc-13-dev) from the mirrored release
#    the WebKit Dockerfile uses.
mkdir -p $tmp/gcc13
tar -xzf '${gcc13}' -C $tmp/gcc13
for deb in $tmp/gcc13/*.deb; do dpkg-deb -x "$deb" '${sysroot}'; done
rm -rf "$tmp"`,
            });
            await verify(`${sysroot} has usr/include/c++/13 after the gcc-13 overlay`, () => {
              if (!existsSync(`${sysroot}/usr/include/c++/13`))
                throw new Error(`${sysroot} missing usr/include/c++/13`);
            });
            log(`installed: ${sysroot} (ubuntu:20.04 glibc ${g.glibcVersion} + gcc-13 libstdc++)`);
          }
        },
      },
    ];
  },
};

/** linux-musl sysroots populated from alpine's own packages via
 * apk.static, so libstdc++ matches the native alpine test image. */
export const muslSysroot: LinuxComponent = {
  name: "musl-sysroot",
  // No downloads: apk.static and the package indexes are fetched inside
  // the script (their versions are FLOATING, discovered at run time).
  artifacts: () => ({}),
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    const m = cross.muslSysroot;
    return [
      {
        name: `Install linux-musl sysroots (alpine ${m.alpineRelease})`,
        run: async () => {
          const cdn = `${m.cdnBase}/v${m.alpineRelease}`;
          // apk.static (host arch) can install foreign-arch packages into any
          // root. The host machine follows from the spec arch (this only runs on
          // the build host). apk.static's version is discovered from the repo
          // index at run time (FLOATING), so this is a script.
          const hostMachine = image.arch === "aarch64" ? "aarch64" : "x86_64";
          const perArch = (["x86_64", "aarch64"] as const)
            .map(
              mlArch => `
sysroot='${m.paths[mlArch]}'
if [ -f "$sysroot/usr/lib/libc.so" ]; then
echo "$sysroot already complete; reusing"
else
rm -rf "$sysroot"; mkdir -p "$sysroot"
"$APK" --arch ${mlArch} --root "$sysroot" --repository '${cdn}/main' \\
--allow-untrusted --no-cache --initdb add ${m.packages.join(" ")}
if [ ! -f "$sysroot/usr/lib/libc.so" ]; then echo "$sysroot not populated" >&2; exit 1; fi
echo "installed: $sysroot"
fi`,
            )
            .join("\n");
          await shellScript({
            describe: `populate the musl sysroots for x86_64 + aarch64 from alpine ${m.alpineRelease} via apk.static`,
            root: true,
            script: `set -ex
tmp="$(mktemp -d)"; cd "$tmp"
curl -fsSL '${cdn}/main/${hostMachine}/APKINDEX.tar.gz' -o APKINDEX.tar.gz
APK_VER="$(tar -xzOf APKINDEX.tar.gz APKINDEX 2>/dev/null | awk '/^P:apk-tools-static$/{f=1} f&&/^V:/{print substr($0,3); exit}')"
if [ -z "$APK_VER" ]; then echo "could not resolve apk-tools-static version" >&2; exit 1; fi
echo "apk-tools-static version: $APK_VER"
curl -fsSL "${cdn}/main/${hostMachine}/apk-tools-static-$APK_VER.apk" -o apk-tools-static.apk
tar -xzf apk-tools-static.apk sbin/apk.static
APK="$tmp/sbin/apk.static"
${perArch}
rm -rf "$tmp"`,
          });
          // No LINUX_MUSL_SYSROOT export: detectLinuxMuslSysroot() picks the
          // arch-appropriate path by well-known location.
        },
      },
    ];
  },
};

/** Windows sysroot: MSVC CRT/STL + Windows SDK splat via xwin, laid out
 * like a Visual Studio install so clang-cl/lld-link's /winsysroot works. */
export const windowsSysroot: LinuxComponent = {
  name: "windows-sysroot",
  artifacts: image => (image.buildHost ? { xwin: xwinDownload(image.crossToolchains, image.arch) } : {}),
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    const w = cross.winSysroot;
    return [
      {
        name: `Install Windows sysroot (xwin ${w.xwinVersion}: SDK ${w.sdkVersion}, CRT ${w.crtVersion})`,
        run: async () => {
          const sysroot = w.path;
          // MSVC CRT/STL + Windows SDK splat for --os=windows cross-compiles, laid
          // out like a Visual Studio install so clang-cl/lld-link's /winsysroot
          // works. Same completeness sentinel scripts/build/winsysroot.ts uses.
          const complete =
            (existsSync(`${sysroot}/Windows Kits/10/lib`) || existsSync(`${sysroot}/Windows Kits/10/Lib`)) &&
            existsSync(`${sysroot}/VC/Tools/MSVC`);
          if (complete) {
            log(`${sysroot} already complete; reusing`);
            return;
          }
          const tarball = await download(artifact(ctx.artifacts, "xwin"));
          const xwinDir = join(scratchDir, "xwin");
          await extractArchive({ file: tarball, into: xwinDir, stripComponents: 1 });
          await removePaths(sysroot, `${sysroot}.cache`);
          await ensureDirectory(sysroot);
          // The cache must be on the same filesystem as the output: splat moves
          // files with rename(2), which fails EXDEV when scratch is tmpfs and
          // /opt is not.
          await ensureDirectory(`${sysroot}.cache`);
          // Both target arches in one splat; --include-debug-libs so /MTd (debug
          // CRT) links work; --include-atl for <atlstr.h>; winsysroot-style + MS
          // arch notation so clang-cl and lld-link resolve it with /winsysroot.
          await sudo([
            join(xwinDir, "xwin"),
            "--accept-license",
            "--arch",
            "x86_64,aarch64",
            "--sdk-version",
            w.sdkVersion,
            "--crt-version",
            w.crtVersion,
            "--include-atl",
            "--cache-dir",
            `${sysroot}.cache`,
            "splat",
            "--use-winsysroot-style",
            "--preserve-ms-arch-notation",
            "--include-debug-libs",
            "--output",
            sysroot,
          ]);
          // clang-cl/lld-link compose SDK paths as "Include"/"Lib" (title case);
          // the winsysroot-style splat writes lowercase — alias both spellings.
          await ensureSymlink("include", `${sysroot}/Windows Kits/10/Include`);
          await ensureSymlink("lib", `${sysroot}/Windows Kits/10/Lib`);
          await removePaths(xwinDir, `${sysroot}.cache`);
          await verify(`${sysroot} has an MSVC tree`, () => {
            if (!existsSync(`${sysroot}/VC/Tools/MSVC`))
              throw new Error(`${sysroot}/VC/Tools/MSVC missing after splat`);
          });
        },
      },
    ];
  },
};

/** macOS SDK for cross-compiling darwin from this linux host, fetched via
 * the repo's vendored xmac.mjs at the bootstrapping ref so bake and build
 * share the same Apple-CDN download path. */
export const macosSdk: LinuxComponent = {
  name: "macos-sdk",
  // xmac.mjs's full URL depends on the bootstrapping ref (known only at
  // bake time, not part of the spec), so the step composes it from the
  // hashed base + ctx.repoRef. The base is declared here so it still
  // participates in the image hash.
  artifacts: image =>
    image.buildHost ? { xmacRawBase: { url: image.crossToolchains.macosSdk.xmacRawBase, sha256: null } } : {},
  steps: ctx => {
    const { image } = ctx;
    if (!image.buildHost) return [];
    const cross = image.crossToolchains;
    const sdk = cross.macosSdk;
    return [
      {
        name: `Install macOS ${sdk.version} SDK`,
        run: async () => {
          // macOS SDK for cross-compiling darwin from this linux host, fetched via
          // the repo's vendored xmac.mjs (from the bootstrapping ref) so the same
          // Apple-CDN download path is used here and at build time.
          // resolveMacosSdkPath() in scripts/build/macos-sdk.ts checks this path
          // before falling back to a per-job download. Same completeness sentinel.
          if (existsSync(`${sdk.path}/MacOSX${sdk.version}.sdk/usr/include/sys/syscall.h`)) {
            log(`${sdk.path} already complete; reusing`);
            return;
          }
          const xmac = await download(
            { url: `${cross.macosSdk.xmacRawBase}/${ctx.repoRef}/scripts/build/xmac.mjs`, sha256: null },
            { name: "xmac.mjs" },
          );
          const staging = join(scratchDir, "macos-sdk");
          await run(["mkdir", "-p", staging]);
          await run([
            linuxBin(image, "bun"),
            xmac,
            "splat",
            "--accept-license",
            "--sdk-only",
            "--release",
            sdk.cltRelease,
            "--sdk",
            sdk.version,
            "--output",
            staging,
            "--cache-dir",
            `${staging}/cache`,
          ]);
          await removePaths(sdk.path);
          await ensureDirectory(sdk.path);
          await moveFile(`${staging}/SDKs/MacOSX${sdk.version}.sdk`, `${sdk.path}/`);
          await setModeRecursive(sdk.path, "a+rX");
          await verify(`${sdk.path}/MacOSX${sdk.version}.sdk is present`, () => {
            if (!existsSync(`${sdk.path}/MacOSX${sdk.version}.sdk/usr/include/sys/syscall.h`)) {
              throw new Error("macOS SDK missing after splat");
            }
          });
        },
      },
    ];
  },
};
