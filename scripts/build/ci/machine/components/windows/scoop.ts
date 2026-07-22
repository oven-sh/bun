// Scoop: the Windows package manager, then the image's pinned package set
// (git, nodejs@x, cmake, ninja, llvm@x, 7zip, nssm, ...). One component,
// two steps in order — the manager install, then the packages — because the
// packages step depends on the manager and nothing sits between them.

import { join } from "node:path";
import * as win from "../../ops-windows.ts";
import { download, invalidateChildPath, log, scratchDir } from "../../runtime.ts";
import type { WindowsComponent } from "../component.ts";
import { artifact } from "../component.ts";
import { windowsSystem32 } from "../paths.ts";

export const scoop: WindowsComponent = {
  name: "scoop",
  artifacts: image => ({
    scoopInstaller: { url: image.scoop.installUrl, sha256: null },
    /** Mirrored nssm zip for when nssm.cc (Scoop's source) is down. */
    nssmFallback: { url: image.nssmFallbackZipUrl, sha256: null },
  }),
  steps: ctx => {
    const { image, ci } = ctx;
    return [
      {
        name: "Install Scoop package manager",
        run: async () => {
          if (await win.commandOnPath("scoop")) {
            log("scoop already installed");
            return;
          }
          // Scoop blocks admin installs unless -RunAsAdmin; a known global
          // location so all users (incl. the agent service) see it. Its
          // installer is fetched and invoked by its own protocol — a script.
          const installer = artifact(ctx.artifacts, "scoopInstaller");
          await win.powershellScript({
            describe: `install Scoop into ${image.scoop.root} via its self-installer (${installer.url})`,
            script: `$env:SCOOP = ${win.psq(image.scoop.root)}
[Environment]::SetEnvironmentVariable('SCOOP', $env:SCOOP, 'Machine')
iex "& {$(irm ${installer.url})} -RunAsAdmin -ScoopDir ${image.scoop.root}"
scoop --version`,
          });
          await win.addToMachinePath(`${image.scoop.root}\\shims`);
        },
      },
      {
        name: `Install Scoop packages (${image.scoop.packages.length})`,
        run: async () => {
          for (const pkg of image.scoop.packages) {
            if (await win.commandOnPath(pkg.command)) {
              log(`${pkg.name}: "${pkg.command}" already on PATH; skipping`);
              continue;
            }
            // post_install scripts can emit non-fatal errors (7zip ARM64
            // 7zr.exe locked, llvm-arm64 missing Uninstall.exe); don't let the
            // error stream fail the step — the PATH verification below catches
            // a genuinely failed install.
            await win.powershellScript({
              describe: `scoop install ${pkg.name}`,
              allowFailure: true,
              script: `$env:Path = ${win.psq(`${image.scoop.root}\\shims`)} + ';' + $env:Path
$prev = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
scoop install ${pkg.name} *>&1 | ForEach-Object { "$_" } | Write-Host
$ErrorActionPreference = $prev`,
            });
            // scoop writes shims onto the Machine PATH; children re-read it.
            invalidateChildPath();
          }
          // Git for Windows ships Unix tools (cat, head, tail, ...) in usr\bin;
          // Cygwin binaries live at <scoop>\apps\cygwin\current\root\bin.
          // Both git and cygwin are in scoopCommonPackages on every windows
          // image, so these dirs exist after the install above — a missing
          // one means the install failed, which should surface, not be
          // silently left off PATH.
          for (const dir of [
            `${image.scoop.root}\\apps\\git\\current\\usr\\bin`,
            `${image.scoop.root}\\apps\\cygwin\\current\\root\\bin`,
          ]) {
            await win.addToMachinePath(dir);
          }
          // Scoop's "adding ... to your path" for app-dir packages (nodejs,
          // llvm, mingw, git\\cmd, ...) writes the BAKE USER's PATH, not the
          // Machine PATH — those packages get no shim, only their own dir on
          // PATH. The bake user sees them (so verification passes) but the
          // runner service account does not: node/clang would be missing at
          // runtime. Promote every scoop dir the user PATH now carries onto
          // the Machine PATH, so scoop stays the authority on which dirs a
          // package needs and only the scope is corrected.
          await win.promoteScoopUserPathToMachine(image.scoop.root);
          if (ci) {
            await win.powershellScript({
              describe: "system-wide git config for CI (safe.directory *, lf, longpaths)",
              script: `git config --system --add safe.directory "*"
git config --system core.autocrlf false
git config --system core.eol lf
git config --system core.longpaths true`,
            });
          }
          // nssm.cc (Scoop's nssm source) 503s regularly; if the Scoop install
          // left no nssm, take the unmodified zip from our mirror. agent.mjs
          // "install" needs nssm to register the service.
          if (!(await win.commandOnPath("nssm"))) {
            log("nssm not installed by Scoop (nssm.cc down?); using the mirror");
            const zip = await download(artifact(ctx.artifacts, "nssmFallback"), { name: "nssm.zip" });
            const extract = join(scratchDir, "nssm-extract");
            await win.extractArchive({ file: zip, into: extract });
            // The zip nests the exe under <versioned-folder>\win64\; locate the
            // win64 directory rather than restating the versioned folder name.
            const win64 = await win.findDirectory(extract, "win64");
            if (!win64) throw new Error(`win64 directory not found in ${zip}`);
            const exe = await win.findFile(win64, "nssm.exe");
            if (!exe) throw new Error(`nssm.exe not found in ${zip}`);
            await win.installFile({ from: exe, to: windowsSystem32(image, "nssm.exe") });
          }
          await win.verify("git, node, cmake, ninja, clang-cl, 7z, nssm are on PATH", async () => {
            for (const command of ["git", "node", "cmake", "ninja", "clang-cl", "7z", "nssm"]) {
              const path = await win.commandOnPath(command);
              if (!path) throw new Error(`After Scoop installs, "${command}" is not on PATH`);
              log(`${command}: ${path}`);
            }
          });
        },
      },
    ];
  },
};
