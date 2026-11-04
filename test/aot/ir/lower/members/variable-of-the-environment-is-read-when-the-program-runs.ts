// RUN: lower

// Whoever builds has PATH set. Without `--env` the build takes no variable's value for a constant.
export function path() {
  return process.env.PATH;
}

// CHECK-LABEL: function {{*}}name="path"
// CHECK: Builtin builtin=Process
// CHECK: PropGet {{*}}key="env"
// CHECK: PropGet {{*}}key="PATH"
