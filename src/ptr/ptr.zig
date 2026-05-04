//! The `ptr` module contains smart pointer types that are used throughout Bun.
pub const Cow = @import("./Cow.zig").Cow;

pub const CowSlice = @import("./CowSlice.zig").CowSlice;
pub const CowSliceZ = @import("./CowSlice.zig").CowSliceZ;
pub const CowString = CowSlice(u8);

pub const owned = @import("./owned.zig");
pub const Owned = owned.Owned; // owned pointer allocated with default allocator
pub const OwnedIn = owned.OwnedIn; // owned pointer allocated with specific type of allocator
pub const DynamicOwned = owned.Dynamic; // owned pointer allocated with any `std.mem.Allocator`

pub const shared = @import("./shared.zig");
pub const Shared = shared.Shared;
pub const AtomicShared = shared.AtomicShared;
pub const ExternalShared = @import("./external_shared.zig").ExternalShared;

pub const ref_count = @import("./ref_count.zig");
/// Deprecated; use `Shared(*T)`.
pub const RefCount = ref_count.RefCount;
/// Deprecated; use `AtomicShared(*T)`.
pub const ThreadSafeRefCount = ref_count.ThreadSafeRefCount;
/// Deprecated; use `Shared(*T)`.
pub const RefPtr = ref_count.RefPtr;

pub const raw_ref_count = @import("./raw_ref_count.zig");
pub const RawRefCount = raw_ref_count.RawRefCount;

pub const TaggedPointer = @import("./tagged_pointer.zig").TaggedPointer;
pub const TaggedPointerUnion = @import("./tagged_pointer.zig").TaggedPointerUnion;

/// Deprecated; use `Shared(*T).Weak`.
pub const WeakPtr = @import("./weak_ptr.zig").WeakPtr;
