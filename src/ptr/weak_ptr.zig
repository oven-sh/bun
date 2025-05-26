pub const WeakPtrData = packed struct(u32) {
    reference_count: u31,
    finalized: bool,

    pub const empty: @This() = .{
        .reference_count = 0,
        .finalized = false,
    };

    pub fn onFinalize(this: *WeakPtrData) bool {
        bun.debugAssert(!this.finalized);
        this.finalized = true;
        return this.reference_count == 0;
    }
};

/// Allow a type to be weakly referenced. This keeps a reference count of how
/// many weak-references exist, so that when the object is destroyed, the inner
/// contents can be freed, but the object itself is not destroyed until all
/// `WeakPtr`s are released. Even if the allocation is present, `WeakPtr(T).get`
/// will return null after the inner contents are freed.
pub fn WeakPtr(comptime T: type, data_field: []const u8) type {
    return struct {
        pub const Data = WeakPtrData;

        raw_ptr: ?*T,

        pub const empty: @This() = .{ .raw_ptr = null };

        pub fn initRef(req: *T) @This() {
            bun.debugAssert(!data(req).finalized);
            data(req).reference_count += 1;
            return .{ .raw_ptr = req };
        }

        pub fn deref(this: *@This()) void {
            if (this.raw_ptr) |value| {
                this.derefInternal(value);
            }
        }

        pub fn get(this: *@This()) ?*T {
            if (this.raw_ptr) |value| {
                if (!data(value).finalized) {
                    return value;
                }

                this.derefInternal(value);
            }
            return null;
        }

        fn derefInternal(this: *@This(), value: *T) void {
            const weak_data = data(value);
            this.raw_ptr = null;
            const count = weak_data.reference_count - 1;
            weak_data.reference_count = count;
            if (weak_data.finalized and count == 0) {
                bun.destroy(value);
            }
        }

        fn data(value: *T) *WeakPtrData {
            return &@field(value, data_field);
        }
    };
}

pub const bun = @import("bun");
