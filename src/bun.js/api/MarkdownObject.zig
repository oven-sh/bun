pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 1);
    object.put(
        globalThis,
        ZigString.static("renderToHTML"),
        jsc.JSFunction.create(
            globalThis,
            "renderToHTML",
            renderToHTML,
            1,
            .{},
        ),
    );

    return object;
}

pub fn renderToHTML(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    if (arguments.len == 0) {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    }

    const input_value = arguments[0];
    if (input_value.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    }

    const buffer = try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, input_value) orelse {
        return globalThis.throwInvalidArguments("Expected a string or buffer to render", .{});
    };
    defer buffer.deinit();

    const input = buffer.slice();

    // Parse options from second argument
    var options: md.Options = .{};
    if (arguments.len > 1 and arguments[1].isObject()) {
        const opts = arguments[1];
        inline for (@typeInfo(md.Options).@"struct".fields) |field| {
            if (field.type == bool) {
                if (try opts.getBooleanLoose(globalThis, field.name)) |val| {
                    @field(options, field.name) = val;
                }
            }
        }
    }

    const result = md.renderToHtmlWithOptions(input, bun.default_allocator, options) catch {
        return globalThis.throwOutOfMemory();
    };
    defer bun.default_allocator.free(result);

    return bun.String.createUTF8ForJS(globalThis, result);
}

const bun = @import("bun");
const md = bun.md;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
