//! Contiguous slice of `Coordinator.files` owned by a worker. Dispatching
//! pulls from the front (cache-hot region); stealing takes from the back
//! (furthest from the owner's hot region).

pub const FileRange = @This();

lo: u32,
hi: u32,

pub fn len(self: @This()) u32 {
    return self.hi - self.lo;
}
pub fn isEmpty(self: @This()) bool {
    return self.lo >= self.hi;
}
pub fn popFront(self: *@This()) ?u32 {
    if (self.isEmpty()) return null;
    defer self.lo += 1;
    return self.lo;
}
/// Take the back half as a new contiguous range for the thief, leaving the
/// owner the front half. The thief then walks its stolen block forward via
/// popFront, so both workers keep directory locality. For len()==1 the
/// single file goes to the thief (owner is either already inflight or was
/// never spawned).
pub fn stealBackHalf(self: *@This()) ?FileRange {
    if (self.isEmpty()) return null;
    const mid = self.lo + self.len() / 2;
    const stolen = FileRange{ .lo = mid, .hi = self.hi };
    self.hi = mid;
    return stolen;
}
