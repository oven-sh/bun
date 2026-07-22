// Rust on windows via rustup-init into the image's rust home. The linux
// half is the rust component in linux/toolchain.ts.

import * as win from "../../ops-windows.ts";
import { download, log, run } from "../../runtime.ts";
import type { WindowsComponent } from "../component.ts";
import { artifact } from "../component.ts";

export const rust: WindowsComponent = {
  name: "rust",
  artifacts: image => ({ rustupInit: { url: image.rust.rustupUrl, sha256: null } }),
  steps: ctx => {
    const { image } = ctx;
    return [
      {
        name: "Install Rust (rustup)",
        run: async () => {
          if (await win.commandOnPath("rustc")) {
            log("rustc already installed");
            return;
          }
          const home = image.rust.home;
          const cargoHome = `${home}\\cargo`;
          const rustupHome = `${home}\\rustup`;
          // rustup resolves BOTH the install location AND the default
          // toolchain from RUSTUP_HOME. Every process that touches rust must
          // therefore see the same RUSTUP_HOME — the installer, the verify
          // below, and every future shell (via the Machine environment). A
          // child that lacks it looks in the default profile location, finds
          // no toolchain, and reports "no default is configured".
          const rustEnv = { CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome };
          // The msvc host triple follows the image arch.
          const defaultHost = image.arch === "aarch64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
          await win.ensureDirectory(home);
          const init = await download(artifact(ctx.artifacts, "rustupInit"), { name: "rustup-init.exe" });
          // Set the homes in the SAME process that runs rustup so it installs
          // under Program Files (not SYSTEM's profile), and name the default
          // toolchain explicitly instead of relying on rustup's implicit
          // per-profile default.
          await win.powershellScript({
            describe: `run rustup-init with CARGO_HOME/RUSTUP_HOME under ${home}`,
            script: `$env:CARGO_HOME = ${win.psq(cargoHome)}
$env:RUSTUP_HOME = ${win.psq(rustupHome)}
& ${win.psq(init)} -y --default-toolchain stable --default-host ${defaultHost} --no-modify-path
if ($LASTEXITCODE -ne 0) { throw "rustup-init failed: $LASTEXITCODE" }`,
          });
          await win.setMachineEnv("CARGO_HOME", cargoHome);
          await win.setMachineEnv("RUSTUP_HOME", rustupHome);
          await win.addToMachinePath(`${cargoHome}\\bin`);
          // The verify child gets the rust homes explicitly: this bootstrap
          // process's inherited environment predates the Machine writes above.
          await win.verify("rustc --version runs", () =>
            run([`${cargoHome}\\bin\\rustc.exe`, "--version"], { env: rustEnv }).then(() => undefined),
          );
        },
      },
    ];
  },
};
