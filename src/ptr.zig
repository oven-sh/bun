//! The `ptr` module contains smart pointer types that are used throughout Bun.

pub const CowString = CowSlice(u8);

pub const Cow = @import("./ptr/Cow.zig").Cow;
pub const WeakPtr = @import("./ptr/weak_ptr.zig").WeakPtr;

pub const CowSlice = @import("./ptr/CowSlice.zig").CowSlice;
pub const CowSliceZ = @import("./ptr/CowSlice.zig").CowSliceZ;

const ref_count = @import("./ptr/ref_count.zig");
pub const RefCount = ref_count.RefCount;
pub const RefPtr = ref_count.RefPtr;
pub const ThreadSafeRefCount = ref_count.ThreadSafeRefCount;

pub const TaggedPointer = @import("./ptr/tagged_pointer.zig").TaggedPointer;
pub const TaggedPointerUnion = @import("./ptr/tagged_pointer.zig").TaggedPointerUnion;
