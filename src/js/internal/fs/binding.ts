// The native `node:fs` binding (`createBinding`), created once here
// and shared by `node:fs`, `node:fs/promises`, and the lazily loaded `internal/fs/*` modules.
export default $native("node_fs_binding.rs", "createBinding") as $ZigGeneratedClasses.NodeJSFS;
