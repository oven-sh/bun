// These are all extern so they can't be top-level structs.
pub const String = @import("../install_types/SemverString.zig").String;
pub const ExternalString = @import("../install_types/ExternalString.zig").ExternalString;
pub const Version = @import("./Version.zig").Version;
pub const VersionType = @import("./Version.zig").VersionType;

pub const SlicedString = @import("../install_types/SlicedString.zig");
pub const Range = @import("./SemverRange.zig");
pub const Query = @import("./SemverQuery.zig");
pub const SemverObject = @import("../semver_jsc/SemverObject.zig");
