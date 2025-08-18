//! The `ptr` module contains smart pointer types that are used throughout Bun.
pub const Cow = @import("./ptr/Cow.zig").Cow;

pub const CowSlice = @import("./ptr/CowSlice.zig").CowSlice;
pub const CowSliceZ = @import("./ptr/CowSlice.zig").CowSliceZ;
pub const CowString = CowSlice(u8);

pub const owned = @import("./ptr/owned.zig");
pub const Owned = owned.Owned; // owned pointer allocated with default allocator
pub const DynamicOwned = owned.Dynamic; // owned pointer allocated with any allocator
pub const MaybeOwned = owned.maybe.MaybeOwned; // owned or borrowed pointer

pub const ref_count = @import("./ptr/ref_count.zig");
pub const RefCount = ref_count.RefCount;
pub const ThreadSafeRefCount = ref_count.ThreadSafeRefCount;
pub const RefPtr = ref_count.RefPtr;

pub const TaggedPointer = @import("./ptr/tagged_pointer.zig").TaggedPointer;
pub const TaggedPointerUnion = @import("./ptr/tagged_pointer.zig").TaggedPointerUnion;

pub const WeakPtr = @import("./ptr/weak_ptr.zig").WeakPtr;
