/**
 * Fixtures for Windows reparse points that are not links.
 *
 * A symlink or junction is a reparse point whose tag is a "name surrogate".
 * Cloud-file placeholders (OneDrive Files On-Demand), deduplicated files,
 * projected files and third-party sync clients also mark their entries with
 * FILE_ATTRIBUTE_REPARSE_POINT, but those entries are ordinary files and
 * directories: a normal open reads their contents and a directory keeps its
 * children. Two ways to make such entries without a sync client installed:
 *
 * - `setNonLinkReparsePoint()` stamps a file or directory with a custom tag
 *   (FSCTL_SET_REPARSE_POINT needs nothing but write access to the entry).
 *   Works on any NTFS volume; the data of a tagged file is unreadable, though,
 *   since no driver owns the tag, so only tagged directories are copyable.
 * - `registerSyncRoot()` + `convertToPlaceholder()` create real cloud-file
 *   placeholders through the Cloud Files API (cldapi.dll), hydrated and in
 *   sync, so they stay readable without a sync provider running. Gate their
 *   use on `cloudFilesAvailable()`.
 *
 * Windows hides the reparse attribute of cloud placeholders from processes
 * that have not declared themselves placeholder-aware (executables run from
 * the Windows directory count as aware); `exposePlaceholders()` opts the
 * current process in so the code under test sees the placeholders.
 *
 * Windows only: gate callers with `isWindows`.
 */
import { dlopen, ptr } from "bun:ffi";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const INVALID_FILE_ATTRIBUTES = 0xffffffff;
const FSCTL_SET_REPARSE_POINT = 0x000900a4;
const PHCM_EXPOSE_PLACEHOLDERS = 2;
const CF_REGISTER_FLAG_DISABLE_ON_DEMAND_POPULATION_ON_ROOT = 2;
const CF_HYDRATION_POLICY_FULL = 2;
const CF_POPULATION_POLICY_ALWAYS_FULL = 3;
const CF_CONVERT_FLAG_MARK_IN_SYNC = 1;

function memoize<T>(load: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= load());
}

const kernel32 = memoize(
  () =>
    dlopen("kernel32.dll", {
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      DeviceIoControl: { args: ["u64", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
      GetFileAttributesW: { args: ["ptr"], returns: "u32" },
      GetLastError: { args: [], returns: "u32" },
    }).symbols,
);

const ntdll = memoize(
  () =>
    dlopen("ntdll.dll", {
      RtlSetProcessPlaceholderCompatibilityMode: { args: ["i8"], returns: "i8" },
    }).symbols,
);

const cldapi = memoize(
  () =>
    dlopen("cldapi.dll", {
      CfRegisterSyncRoot: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
      CfUnregisterSyncRoot: { args: ["ptr"], returns: "i32" },
      CfConvertToPlaceholder: { args: ["u64", "ptr", "u32", "u32", "ptr", "ptr"], returns: "i32" },
    }).symbols,
);

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");
const hresult = (hr: number) => "0x" + (hr >>> 0).toString(16);

function withHandle<T>(path: string, access: number, flags: number, fn: (handle: number | bigint) => T): T {
  const k32 = kernel32();
  const pathW = wide(path);
  const handle = k32.CreateFileW(ptr(pathW), access >>> 0, FILE_SHARE_ALL, null, OPEN_EXISTING, flags, null);
  if (handle === INVALID_HANDLE_VALUE) {
    throw new Error(`CreateFileW(${path}) failed: Win32 error ${k32.GetLastError()}`);
  }
  try {
    return fn(handle);
  } finally {
    k32.CloseHandle(handle);
  }
}

/** `GetFileAttributesW` of the entry itself; a reparse point is not followed. */
export function fileAttributes(path: string): number {
  const k32 = kernel32();
  const pathW = wide(path);
  const attributes = k32.GetFileAttributesW(ptr(pathW));
  if (attributes === INVALID_FILE_ATTRIBUTES) {
    throw new Error(`GetFileAttributesW(${path}) failed: Win32 error ${k32.GetLastError()}`);
  }
  return attributes;
}

export function isReparsePoint(path: string): boolean {
  return (fileAttributes(path) & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
}

/** Set on directories and on directory-flavored links (directory symlinks, junctions). */
export function hasDirectoryAttribute(path: string): boolean {
  return (fileAttributes(path) & FILE_ATTRIBUTE_DIRECTORY) !== 0;
}

/**
 * Stamps an existing file or directory with a non-Microsoft reparse tag that
 * is not a name surrogate. A directory gets the tag's "directory" bit (bit 28),
 * which tells NTFS the directory still holds real children; that is the shape
 * cloud and projected-file-system directories have.
 */
export function setNonLinkReparsePoint(path: string): void {
  const k32 = kernel32();
  const isDirectory = (fileAttributes(path) & FILE_ATTRIBUTE_DIRECTORY) !== 0;
  const payload = Buffer.from("bun test reparse point");
  // REPARSE_GUID_DATA_BUFFER: tag, data length, reserved, GUID, data.
  const buffer = Buffer.alloc(8 + 16 + payload.length);
  buffer.writeUInt32LE(isDirectory ? 0x10000bad : 0x00000bad, 0);
  buffer.writeUInt16LE(payload.length, 4);
  Buffer.from("0b7e5d1e2f3a4b5c8d9e0f1a2b3c4d5e", "hex").copy(buffer, 8);
  payload.copy(buffer, 24);
  const bytesReturned = Buffer.alloc(4);
  withHandle(path, GENERIC_WRITE, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, handle => {
    const ok = k32.DeviceIoControl(
      handle,
      FSCTL_SET_REPARSE_POINT,
      ptr(buffer),
      buffer.length,
      null,
      0,
      ptr(bytesReturned),
      null,
    );
    if (!ok) throw new Error(`FSCTL_SET_REPARSE_POINT(${path}) failed: Win32 error ${k32.GetLastError()}`);
  });
}

/**
 * Makes cloud-file placeholders show their reparse attribute to this process.
 * Disposing restores the previous mode.
 */
export function exposePlaceholders(): Disposable {
  const nt = ntdll();
  const previous = nt.RtlSetProcessPlaceholderCompatibilityMode(PHCM_EXPOSE_PLACEHOLDERS);
  if (previous < 0) throw new Error(`RtlSetProcessPlaceholderCompatibilityMode failed: ${previous}`);
  return {
    [Symbol.dispose]() {
      nt.RtlSetProcessPlaceholderCompatibilityMode(previous);
    },
  };
}

/**
 * Registers the existing directory `root` as a Cloud Files sync root so that
 * entries below it can become placeholders; the directory itself gets a cloud
 * reparse tag too. Dispose before deleting `root`: unregistering needs the
 * directory to still exist.
 */
export function registerSyncRoot(root: string): Disposable {
  const cf = cldapi();
  const rootW = wide(root);
  const providerName = wide("bun test");
  const providerVersion = wide("1.0");
  // CF_SYNC_REGISTRATION (64-bit layout): StructSize, ProviderName, ProviderVersion,
  // SyncRootIdentity, SyncRootIdentityLength, FileIdentity, FileIdentityLength, ProviderId.
  const registration = Buffer.alloc(72);
  registration.writeUInt32LE(registration.length, 0);
  registration.writeBigUInt64LE(BigInt(ptr(providerName)), 8);
  registration.writeBigUInt64LE(BigInt(ptr(providerVersion)), 16);
  // CF_SYNC_POLICIES: StructSize, Hydration, Population, InSync, HardLink, PlaceholderManagement.
  const policies = Buffer.alloc(24);
  policies.writeUInt32LE(policies.length, 0);
  policies.writeUInt16LE(CF_HYDRATION_POLICY_FULL, 4);
  policies.writeUInt16LE(CF_POPULATION_POLICY_ALWAYS_FULL, 8);
  const hr = cf.CfRegisterSyncRoot(
    ptr(rootW),
    ptr(registration),
    ptr(policies),
    CF_REGISTER_FLAG_DISABLE_ON_DEMAND_POPULATION_ON_ROOT,
  );
  if (hr !== 0) throw new Error(`CfRegisterSyncRoot(${root}) failed: ${hresult(hr)}`);
  return {
    [Symbol.dispose]() {
      const hr = cf.CfUnregisterSyncRoot(ptr(rootW));
      if (hr !== 0) throw new Error(`CfUnregisterSyncRoot(${root}) failed: ${hresult(hr)}`);
    },
  };
}

/**
 * Turns an existing file or directory under a registered sync root into a
 * hydrated, in-sync placeholder: it gains a cloud reparse tag while its
 * contents (or children) stay on disk.
 */
export function convertToPlaceholder(path: string): void {
  const cf = cldapi();
  const identity = Buffer.from(path);
  withHandle(path, GENERIC_READ | GENERIC_WRITE, FILE_FLAG_BACKUP_SEMANTICS, handle => {
    const hr = cf.CfConvertToPlaceholder(
      handle,
      ptr(identity),
      identity.length,
      CF_CONVERT_FLAG_MARK_IN_SYNC,
      null,
      null,
    );
    if (hr !== 0) throw new Error(`CfConvertToPlaceholder(${path}) failed: ${hresult(hr)}`);
  });
}

/**
 * Whether this machine lets us create placeholders: cldapi.dll is present, the
 * cloud filter is running and the current user may register a sync root. Found
 * out by registering (and unregistering) one on a scratch directory, once.
 * Only call on Windows x64, where the ffi fixtures work at all.
 */
export const cloudFilesAvailable = memoize((): boolean => {
  const scratch = mkdtempSync(join(realpathSync.native(tmpdir()), "cloud-files-probe-"));
  try {
    registerSyncRoot(scratch)[Symbol.dispose]();
    return true;
  } catch {
    return false;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
