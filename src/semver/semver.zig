// These are all extern so they can't be top-level structs.
pub const String = @import("../install_types/SemverString.rust").String;
pub const ExternalString = @import("../install_types/ExternalString.rust").ExternalString;
pub const Version = @import("./Version.rust").Version;
pub const VersionType = @import("./Version.rust").VersionType;

pub const SlicedString = @import("../install_types/SlicedString.rust");
pub const Range = @import("./SemverRange.rust");
pub const Query = @import("./SemverQuery.rust");
pub const SemverObject = @import("../semver_jsc/SemverObject.rust");
