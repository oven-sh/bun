// These are all extern so they can't be top-level structs.

pub const Query = @import("./semver/SemverQuery.zig");
pub const Range = @import("./semver/SemverRange.zig");
pub const SemverObject = @import("./semver/SemverObject.zig");
pub const SlicedString = @import("./semver/SlicedString.zig");
pub const ExternalString = @import("./semver/ExternalString.zig").ExternalString;
pub const String = @import("./semver/SemverString.zig").String;
pub const Version = @import("./semver/Version.zig").Version;
