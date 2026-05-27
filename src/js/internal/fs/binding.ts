// The native `node:fs` binding (`createBinding` in `node_fs_binding.zig`), created once here
// and shared by `node:fs`, `node:fs/promises`, and the lazily loaded `internal/fs/*` modules.
export default $zig("node_fs_binding.zig", "createBinding") as $ZigGeneratedClasses.NodeJSFS;
