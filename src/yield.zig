pub fn Yield(comptime Type: anytype) type {
    return struct {
        frame: @Frame(Type) = undefined,
        wait: bool = false,

        pub fn set(this: *@This(), frame: anytype) void {
            this.wait = true;
            this.frame = frame.*;
        }

        pub fn maybeResume(this: *@This()) void {
            if (!this.wait) return;
            this.wait = false;
            resume this.frame;
        }
    };
}
