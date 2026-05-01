// These are all extern so they can't be top-level structs.
pub const String = @import("./semver/SemverString.zig").String;
pub const ExternalString = @import("./semver/ExternalString.zig").ExternalString;
pub const Version = @import("./semver/Version.zig").Version;
pub const VersionType = @import("./semver/Version.zig").VersionType;

pub const SlicedString = @import("./semver/SlicedString.zig");
pub const Range = @import("./semver/SemverRange.zig");
pub const Query = @import("./semver/SemverQuery.zig");
pub const SemverObject = @import("./semver/SemverObject.zig");
