const JSC = @import("root").bun.JSC;
export fn JS2Zig__createBinding(global: *JSC.JSGlobalObject) JSC.JSValue {
  return @import("../node/node_fs_binding.zig").createBinding(global);
}
export fn JS2Zig__createNodeHttp_Binding(global: *JSC.JSGlobalObject) JSC.JSValue {
  return @import("../api/bun/h2_frame_parser.zig").createNodeHttp2Binding(global);
}
export fn JS2Zig__OS_create(global: *JSC.JSGlobalObject) JSC.JSValue {
  return @import("../node/node_os.zig").OS.create(global);
}
export fn JS2Zig__String_jsGetStringWidth(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) JSC.JSValue {
  return @import("../../string.zig").String.jsGetStringWidth(global, call_frame);
}
export fn JS2Zig__parseArgs(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) JSC.JSValue {
  return @import("../node/util/parse_args.zig").parseArgs(global, call_frame);
}
export fn JS2Zig__QuickAndDirtyJavaScriptSyntaxHighlighter_jsFunctionSyntaxHighlight(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) JSC.JSValue {
  return @import("../../fmt.zig").QuickAndDirtyJavaScriptSyntaxHighlighter.jsFunctionSyntaxHighlight(global, call_frame);
}
comptime {
  _ = &JS2Zig__createBinding;
  _ = &JS2Zig__createNodeHttp_Binding;
  _ = &JS2Zig__OS_create;
}