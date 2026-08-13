import { $ } from "bun";
import { config } from "./config";
import { fail, output, succeeds, sudoRead, sudoWrite } from "./shell";

const user = config.ciUser;
const passwordFile = "/var/root/ci-user-password";
const kcpasswordKey = [0x7d, 0x89, 0x52, 0x23, 0xd2, 0xbc, 0xdd, 0xea, 0xa3, 0xb9, 0x1f];

export const ciUserExists = () => succeeds($`id ${user}`);

export async function ciUserHome(): Promise<string> {
  const line = await output($`dscl . -read /Users/${user} NFSHomeDirectory`);
  return line.split(/\s+/)[1] ?? fail(`no home directory for ${user}`);
}

export const ciUserId = async () => Number(await output($`id -u ${user}`));

export async function ensureCiUser(): Promise<void> {
  if (await ciUserExists()) return;
  await $`sudo /bin/sh -c ${`umask 077; openssl rand -hex 24 > ${passwordFile}`}`;
  const password = (await sudoRead(passwordFile)) ?? fail(`could not read ${passwordFile}`);
  await $`sudo sysadminctl -addUser ${user} -fullName CI -shell /bin/zsh -home /Users/${user} -password ${password}`.quiet();
  await $`sudo createhomedir -c -u ${user}`.quiet().nothrow();
  await $`sudo dseditgroup -o edit -d ${user} -t user admin`.quiet().nothrow();
}

// loginwindow reads the auto-login password from /etc/kcpassword, XOR'd with a fixed key and padded to 12 bytes
function kcpassword(password: string): Uint8Array {
  const bytes = [...Buffer.from(password), 0];
  while (bytes.length % 12) bytes.push(0);
  return Uint8Array.from(bytes, (byte, i) => byte ^ kcpasswordKey[i % kcpasswordKey.length]);
}

export async function enableAutoLogin(): Promise<void> {
  const password =
    (await sudoRead(passwordFile)) ??
    fail(`${passwordFile} missing; cannot configure auto-login for an existing ${user}`);
  await sudoWrite("/etc/kcpassword", kcpassword(password), "600");
  await $`sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser ${user}`;
  await $`sudo defaults write /Library/Preferences/com.apple.loginwindow DisableScreenLockImmediate -bool true`;
  await $`sudo pmset -a sleep 0 displaysleep 0 disksleep 0 womp 1 autorestart 1`.quiet();
}
