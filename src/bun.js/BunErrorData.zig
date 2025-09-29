/// TaggedPointerUnion for different error data types that can be attached to ErrorInstance
pub const BunErrorData = TaggedPointerUnion(.{
    BuildMessage,
    ResolveMessage,
});

extern fn JSC__JSErrorInstance__bunErrorData(JSValue0: jsc.JSValue) ?*anyopaque;

/// Get BuildMessage from tagged pointer (returns null if not a BuildMessage)
pub export fn Bun__getBuildMessage(ptr: ?*anyopaque) ?*BuildMessage {
    if (ptr == null) return null;
    const data = BunErrorData.from(ptr);
    if (!data.is(BuildMessage)) return null;
    return data.as(BuildMessage);
}

/// Get ResolveMessage from tagged pointer (returns null if not a ResolveMessage)
pub export fn Bun__getResolveMessage(ptr: ?*anyopaque) ?*ResolveMessage {
    if (ptr == null) return null;
    const data = BunErrorData.from(ptr);
    if (!data.is(ResolveMessage)) return null;
    return data.as(ResolveMessage);
}

/// Finalize the bunErrorData based on its type
pub export fn Bun__errorInstance__finalize(ptr: ?*anyopaque) void {
    if (ptr == null) return;
    const data = BunErrorData.from(ptr);

    if (data.is(BuildMessage)) {
        const build_message = data.as(BuildMessage);
        build_message.finalize();
        bun.destroy(build_message);
    } else if (data.is(ResolveMessage)) {
        const resolve_message = data.as(ResolveMessage);
        resolve_message.finalize();
        bun.destroy(resolve_message);
    }
}

const BuildMessage = @import("./BuildMessage.zig").BuildMessage;
const ResolveMessage = @import("./ResolveMessage.zig").ResolveMessage;

const bun = @import("bun");
const TaggedPointerUnion = bun.TaggedPointerUnion;

const jsc = bun.jsc;

pub fn fromJS(value: jsc.JSValue) ?BunErrorData {
    const ptr = JSC__JSErrorInstance__bunErrorData(value);
    if (ptr == null) return null;
    return BunErrorData.from(ptr);
}
