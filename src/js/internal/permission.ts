// Node's permission model (`--permission`): the shared gate builtin modules
// use. `has()` calls straight into the native predicate so user code
// tampering with `process.permission` cannot widen the sandbox.

const enabled: boolean = $rust("permission.rs", "isPermissionModelEnabled");
let isGranted: (scope: string, reference?: string) => boolean;

function has(scope: string, reference?: string): boolean {
  isGranted ??= $newRustFunction("permission.rs", "jsIsGranted", 2);
  return isGranted(scope, reference);
}

const flagByScope = {
  __proto__: null,
  "fs.read": "--allow-fs-read",
  "fs.write": "--allow-fs-write",
  child: "--allow-child-process",
  net: "--allow-net",
  worker: "--allow-worker",
  wasi: "--allow-wasi",
  inspector: "--allow-inspector",
  addon: "--allow-addons",
};

const permissionStringByScope = {
  __proto__: null,
  "fs.read": "FileSystemRead",
  "fs.write": "FileSystemWrite",
  child: "ChildProcess",
  net: "Net",
  worker: "WorkerThreads",
  wasi: "WASI",
  inspector: "Inspector",
  addon: "Addon",
};

/** The error shape node's `permission::CreateAccessDeniedError` raises. */
function accessDeniedError(scope: string, resource: string = ""): Error {
  const err = $ERR_ACCESS_DENIED(
    `Access to this API has been restricted. Use ${flagByScope[scope]} to manage permissions.`,
  );
  err.permission = permissionStringByScope[scope];
  err.resource = resource;
  return err;
}

/** `new ERR_ACCESS_DENIED(msg)` as node's JS layer raises it (lib/fs.js). */
function customAccessDeniedError(message: string): Error {
  const err = $ERR_ACCESS_DENIED(message);
  err.permission = "";
  err.resource = "";
  return err;
}

const channelByPermission = {
  __proto__: null,
  FileSystem: "node:permission-model:fs",
  FileSystemRead: "node:permission-model:fs",
  FileSystemWrite: "node:permission-model:fs",
  ChildProcess: "node:permission-model:child",
  WorkerThreads: "node:permission-model:worker",
  Net: "node:permission-model:net",
  Inspector: "node:permission-model:inspector",
  WASI: "node:permission-model:wasi",
  Addon: "node:permission-model:addon",
};

let dc;
let publishing = false;

/**
 * `Permission::is_scope_granted` / `Permission::Drop` in node's
 * src/permission/permission.cc publish denied checks and drops to the
 * `node:permission-model:*` diagnostics channels. Called from the native
 * `process.permission.has`/`drop`; `publishing` is node's re-entrancy guard
 * (a subscriber calling `has()` must not recurse).
 */
function publishPermissionEvent(permission: string, resource: string, drop: boolean) {
  if (publishing) return;
  const name = channelByPermission[permission];
  if (name === undefined) return;
  dc ??= require("node:diagnostics_channel");
  const channel = dc.channel(name);
  if (!channel.hasSubscribers) return;
  publishing = true;
  try {
    const message: any = { permission, resource };
    if (drop) message.drop = true;
    channel.publish(message);
  } finally {
    publishing = false;
  }
}

export default { enabled, has, accessDeniedError, customAccessDeniedError, publishPermissionEvent };
