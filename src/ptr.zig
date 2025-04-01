//! The `ptr` module contains smart pointer types that are used throughout Bun.
pub const Cow = @import("ptr/Cow.zig").Cow;
pub const CowSlice = @import("ptr/CowSlice.zig").CowSlice;
pub const CowSliceZ = @import("ptr/CowSlice.zig").CowSliceZ;
pub const CowString = CowSlice(u8);
pub const NewRefCounted = @import("ptr/ref_count.zig").NewRefCounted;
pub const NewThreadSafeRefCounted = @import("ptr/ref_count.zig").NewThreadSafeRefCounted;
pub const TaggedPointer = @import("ptr/tagged_pointer.zig").TaggedPointer;
pub const TaggedPointerUnion = @import("ptr/tagged_pointer.zig").TaggedPointerUnion;
