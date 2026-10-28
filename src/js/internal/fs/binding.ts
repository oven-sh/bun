// The native `node:fs` binding (`createBinding`), created once here
// and shared by `node:fs`, `node:fs/promises`, and the lazily loaded `internal/fs/*` modules.
export default $bindgen("node_fs_binding.bind.ts", "binding") as $Node.NodeJSFS;
