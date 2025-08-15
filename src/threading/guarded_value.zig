/// A wrapper around a mutex, and a value protected by the mutex.
/// `Mutex` should have `lock` and `unlock` methods and should be initializable with `.{}`.
pub fn GuardedValue(comptime Value: type, comptime Mutex: type) type {
    return struct {
        const Self = @This();

        /// The raw value. Don't use this if there might be concurrent accesses.
        unsynchronized_value: Value,
        mutex: Mutex,

        pub fn init(value: Value, mutex: Mutex) Self {
            return .{ .unsynchronized_value = value, .mutex = mutex };
        }

        /// Lock the mutex and return a pointer to the value. Remember to call `unlock`!
        pub fn lock(self: *Self) *Value {
            self.mutex.lock();
            return &self.unsynchronized_value;
        }

        /// Unlock the mutex. Don't use any pointers returned by `lock` after calling this method!
        pub fn unlock(self: *Self) void {
            self.mutex.unlock();
        }
    };
}

pub fn DebugGuardedValue(comptime Value: type) type {
    return GuardedValue(Value, bun.safety.ThreadLock);
}

const bun = @import("bun");
