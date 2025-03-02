//! Scope slot counter
//! Tracks nested scope slot counts

const Symbol = @import("Symbol.zig");

/// SlotCounts tracks the number of slots used for each namespace in nested scopes.
/// Used during scope analysis to determine slot allocation.
const SlotCounts = @This();

/// Array of slot counts for each namespace
slots: Symbol.SlotNamespace.CountsArray = Symbol.SlotNamespace.CountsArray.initFill(0),

/// Take the maximum of this and other slot counts
pub fn unionMax(this: *SlotCounts, other: SlotCounts) void {
    for (&this.slots.values, other.slots.values) |*a, b| {
        if (a.* < b) a.* = b;
    }
}