/// Q: When to use this type?
/// A: When you have to default initialize a field to `undefined` because you
///    can't initialize it right away. (For example the `jsc: *VM` field in
///    `VirtualMachine.zig`)
///
///    This wrapper type inserts checks in debug builds that ensure we're not
///    accidentally forgetting to set it and causing subtle and time-wasting
///    bugs!
///
/// Q: Why though, can't I just remember to initialize it?
/// A: *You* might remember to initialize it, but someone else using the API may
///    not, or a refactoring may forget it, and as we all know `undefined` in Zig
///    causes subtle and extremely time-consuming btle bugs.
///
///    Fun fact: I wasted 30 minutes fixing a bug that turned out to be a field
///    defaulted to `undefined` that didn't get set! So please, use this wrapper
///    type to save everyone's time and patience :)
///
/// Q: Why not just use an optional? (e.g. `my_field: ?T = null`)
/// A: A lot of the fields that get default set to undefined are only
///    *temporarily* unset during initialization. It is annoying to have to unwrap
///    optionals when 99% of the program will have the field initialized.
///
/// Q: Okay, how do I use it?
/// A: Read on:
///
/// # Example
///
/// Take a field that was previously default initialized to `undefined`:
/// ```zig
/// const VirtualMachine = struct {
///     jsc: *VM = undefined,
/// };
/// ```
///
/// And use `CheckedField(T)` instead!
/// ```zig
/// const VirtualMachine = struct {
///     jsc: CheckedField(*VM) = .{},
/// };
/// ```
///
/// You can then call `this.jsc.set(value)` to initialize it and
/// `this.jsc.get()` to get the value.
///
/// Congratulations! You've just saved everyone's time!
pub fn CheckedField(comptime T: type) type {
    const enabled = bun.Environment.isDebug;
    return struct {
        __value: T = undefined,
        __is_init: if (enabled) bool else void = if (enabled) false else {},

        const This = @This();

        pub inline fn get(this: *const This) T {
            this.assertInitialized();
            return this.__value;
        }

        pub inline fn getPtr(this: *const This) *const T {
            this.assertInitialized();
            return &this.__value;
        }

        pub inline fn mut(this: *This) *T {
            this.assertInitialized();
            return &this.__value;
        }

        pub inline fn set(this: *This, value: T) void {
            this.__value = value;
            if (comptime enabled) {
                this.__is_init = true;
            }
        }

        pub inline fn assertInitialized(this: *const This) void {
            if (comptime enabled) {
                if (!this.__is_init) {
                    @panic("MaybeUninit: Not initialized");
                }
            }
        }
    };
}

const std = @import("std");
const bun = @import("bun");
