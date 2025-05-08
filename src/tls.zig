const bun = @import("bun");

// These variables are set by the CLI parser.

// These get read by node_tls_binding.zig for `tls.ts` to consume and use
// as the values for `tls.DEFAULT_MIN_VERSION` and `tls.DEFAULT_MAX_VERSION`

// A null value means no CLI flag was provided, and the *default* defaults
// are defined in src/js/node/tls.ts

pub var min_tls_version_from_cli_flag: ?u16 = null;
pub var max_tls_version_from_cli_flag: ?u16 = null;
