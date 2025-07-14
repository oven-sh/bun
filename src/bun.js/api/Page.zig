const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const Allocator = std.mem.Allocator;
const ZigString = JSC.ZigString;

pub const Page = struct {
    // Generated bindings
    pub const js = JSC.Codegen.JSPage;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    // Page state
    browser: *@import("Browser.zig").Browser,
    target_id: []const u8,
    session_id: []const u8,
    url_value: []const u8 = "about:blank",
    is_closed: bool = false,
    viewport: ?Viewport = null,
    allocator: Allocator,
    
    // CDP state
    frame_id: ?[]const u8 = null,
    lifecycle_state: LifecycleState = .init,

    // Input interfaces (cached)
    keyboard_interface: ?*Keyboard = null,
    mouse_interface: ?*Mouse = null,
    touchscreen_interface: ?*Touchscreen = null,

    pub const Viewport = struct {
        width: u32,
        height: u32,
        device_scale_factor: f64 = 1.0,
        is_mobile: bool = false,
        has_touch: bool = false,
        is_landscape: bool = false,
    };

    pub const LifecycleState = enum {
        init,
        loading,
        loaded,
        networkidle,
    };

    pub const NavigationOptions = struct {
        timeout: ?u32 = null,
        wait_until: ?[]const u8 = null,
        referer: ?[]const u8 = null,
    };

    pub const ScreenshotOptions = struct {
        path: ?[]const u8 = null,
        type: ?[]const u8 = null, // "png" | "jpeg" | "webp"
        quality: ?u8 = null,
        full_page: ?bool = null,
        clip: ?ClipRect = null,
        omit_background: ?bool = null,
        encoding: ?[]const u8 = null, // "base64" | "binary"
    };

    pub const ClipRect = struct {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    };

    pub const new = bun.TrivialNew(@This());

    pub fn create(globalObject: *JSGlobalObject, browser: *@import("Browser.zig").Browser) !*Page {
        const allocator = bun.default_allocator;
        
        const page = bun.new(Page, Page{
            .browser = browser,
            .target_id = try generateTargetId(allocator),
            .session_id = try generateSessionId(allocator),
            .allocator = allocator,
        });

        // Initialize page via CDP
        try page.initializePage(globalObject);

        return page;
    }

    fn initializePage(self: *Page, globalObject: *JSGlobalObject) !void {
        // Send CDP commands to set up the page
        // Target.createTarget, Runtime.enable, Page.enable, etc.
        _ = globalObject;
        
        // Set default viewport
        self.viewport = Viewport{
            .width = 1280,
            .height = 720,
        };
    }

    pub fn goto(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        if (callFrame.argumentCount() < 1) {
            return globalObject.throw("goto() requires a URL argument", .{});
        }

        const url_arg = callFrame.argument(0);
        if (!url_arg.isString()) {
            return globalObject.throw("URL must be a string", .{});
        }

        const url = url_arg.toSlice(globalObject, this.allocator).slice();
        
        // Parse navigation options
        var options = NavigationOptions{};
        if (callFrame.argumentCount() > 1) {
            const options_obj = callFrame.argument(1);
            if (!options_obj.isUndefinedOrNull()) {
                try parseNavigationOptions(globalObject, options_obj, &options);
            }
        }

        // Navigate via CDP Page.navigate
        try this.navigate(globalObject, url, &options);

        // Return Response-like object
        const response = JSValue.createEmptyObject(globalObject, 4);
        response.put(globalObject, ZigString.static("url"), JSValue.createStringFromUTF8(globalObject, url));
        response.put(globalObject, ZigString.static("status"), JSValue.jsNumber(200));
        response.put(globalObject, ZigString.static("ok"), JSValue.jsBoolean(true));
        response.put(globalObject, ZigString.static("statusText"), JSValue.createStringFromUTF8(globalObject, "OK"));

        return response;
    }

    fn navigate(self: *Page, globalObject: *JSGlobalObject, url: []const u8, options: *const NavigationOptions) !void {
        _ = globalObject;
        _ = options;
        
        // Update internal URL
        if (self.url_value.len > 0 and !std.mem.eql(u8, self.url_value, "about:blank")) {
            self.allocator.free(self.url_value);
        }
        self.url_value = try self.allocator.dupe(u8, url);
        
        // Send CDP command: Page.navigate
        // This would send a WebSocket message to Chrome DevTools
    }

    pub fn goBack(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }
        
        // Parse options
        var options = NavigationOptions{};
        if (callFrame.argumentCount() > 0) {
            const options_obj = callFrame.argument(0);
            if (!options_obj.isUndefinedOrNull()) {
                try parseNavigationOptions(globalObject, options_obj, &options);
            }
        }

        // Send CDP Page.goBack
        return JSValue.jsNull();
    }

    pub fn goForward(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }
        
        // Parse options  
        var options = NavigationOptions{};
        if (callFrame.argumentCount() > 0) {
            const options_obj = callFrame.argument(0);
            if (!options_obj.isUndefinedOrNull()) {
                try parseNavigationOptions(globalObject, options_obj, &options);
            }
        }

        // Send CDP Page.goForward
        return JSValue.jsNull();
    }

    pub fn reload(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }
        
        // Parse options
        var options = NavigationOptions{};
        if (callFrame.argumentCount() > 0) {
            const options_obj = callFrame.argument(0);
            if (!options_obj.isUndefinedOrNull()) {
                try parseNavigationOptions(globalObject, options_obj, &options);
            }
        }

        // Send CDP Page.reload
        return JSValue.jsNull();
    }

    pub fn content(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        _ = callFrame;
        
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        // Send CDP Runtime.evaluate with document.documentElement.outerHTML
        // For now, return a placeholder
        return JSValue.createStringFromUTF8(globalObject, "<html><head></head><body></body></html>");
    }

    pub fn setContent(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        if (callFrame.argumentCount() < 1) {
            return globalObject.throw("setContent() requires HTML content", .{});
        }

        const html_arg = callFrame.argument(0);
        if (!html_arg.isString()) {
            return globalObject.throw("HTML content must be a string", .{});
        }

        const html = html_arg.toSlice(globalObject, this.allocator).slice();
        
        // Parse options
        var options = NavigationOptions{};
        if (callFrame.argumentCount() > 1) {
            const options_obj = callFrame.argument(1);
            if (!options_obj.isUndefinedOrNull()) {
                try parseNavigationOptions(globalObject, options_obj, &options);
            }
        }

        // Send CDP Page.setDocumentContent
        _ = html;
        _ = options;
        
        return JSValue.jsUndefined();
    }

    pub fn title(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        _ = callFrame;
        
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        // Send CDP Runtime.evaluate with document.title
        // For now, return a placeholder
        return JSValue.createStringFromUTF8(globalObject, "");
    }

    pub fn getUrl(this: *Page, globalObject: *JSGlobalObject) JSValue {
        return JSValue.createStringFromUTF8(globalObject, this.url_value);
    }

    pub fn evaluate(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        if (callFrame.argumentCount() < 1) {
            return globalObject.throw("evaluate() requires a function or string", .{});
        }

        const page_function = callFrame.argument(0);
        const args = if (callFrame.argumentCount() > 1) callFrame.argument(1) else JSValue.jsUndefined();

        // Convert function to string if needed
        var expression: []const u8 = undefined;
        if (page_function.isString()) {
            expression = page_function.toSlice(globalObject, this.allocator).slice();
        } else if (page_function.isFunction()) {
            // Convert function to string
            const func_str = page_function.toString(globalObject);
            expression = func_str.toSlice(globalObject, this.allocator).slice();
        } else {
            return globalObject.throw("First argument must be a function or string", .{});
        }

        // Send CDP Runtime.evaluate
        _ = expression;
        _ = args;
        
        // For now, return undefined
        return JSValue.jsUndefined();
    }

    pub fn screenshot(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        // Parse screenshot options
        var options = ScreenshotOptions{};
        if (callFrame.argumentCount() > 0) {
            const options_obj = callFrame.argument(0);
            if (!options_obj.isUndefinedOrNull()) {
                try parseScreenshotOptions(globalObject, options_obj, &options);
            }
        }

        // Send CDP Page.captureScreenshot
        _ = options;
        
        // Return Buffer with image data
        const buffer = JSValue.createBuffer(globalObject, &[_]u8{}, this.allocator);
        return buffer;
    }

    pub fn getKeyboard(this: *Page, globalObject: *JSGlobalObject) ?JSValue {
        if (this.keyboard_interface == null) {
            this.keyboard_interface = Keyboard.create(globalObject, this) catch return null;
        }
        return this.keyboard_interface.?.toJS(globalObject);
    }

    pub fn getMouse(this: *Page, globalObject: *JSGlobalObject) ?JSValue {
        if (this.mouse_interface == null) {
            this.mouse_interface = Mouse.create(globalObject, this) catch return null;
        }
        return this.mouse_interface.?.toJS(globalObject);
    }

    pub fn getTouchscreen(this: *Page, globalObject: *JSGlobalObject) ?JSValue {
        if (this.touchscreen_interface == null) {
            this.touchscreen_interface = Touchscreen.create(globalObject, this) catch return null;
        }
        return this.touchscreen_interface.?.toJS(globalObject);
    }

    pub fn getViewport(this: *Page, globalObject: *JSGlobalObject) JSValue {
        if (this.viewport) |viewport| {
            const obj = JSValue.createEmptyObject(globalObject, 6);
            obj.put(globalObject, ZigString.static("width"), JSValue.jsNumber(@floatFromInt(viewport.width)));
            obj.put(globalObject, ZigString.static("height"), JSValue.jsNumber(@floatFromInt(viewport.height)));
            obj.put(globalObject, ZigString.static("deviceScaleFactor"), JSValue.jsNumber(viewport.device_scale_factor));
            obj.put(globalObject, ZigString.static("isMobile"), JSValue.jsBoolean(viewport.is_mobile));
            obj.put(globalObject, ZigString.static("hasTouch"), JSValue.jsBoolean(viewport.has_touch));
            obj.put(globalObject, ZigString.static("isLandscape"), JSValue.jsBoolean(viewport.is_landscape));
            return obj;
        }
        return JSValue.jsNull();
    }

    pub fn setViewport(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.is_closed) {
            return globalObject.throw("Page is closed", .{});
        }

        if (callFrame.argumentCount() < 1) {
            return globalObject.throw("setViewport() requires viewport options", .{});
        }

        const viewport_obj = callFrame.argument(0);
        if (viewport_obj.isUndefinedOrNull()) {
            return globalObject.throw("Viewport options cannot be null", .{});
        }

        // Parse viewport
        var viewport = Viewport{ .width = 1280, .height = 720 };
        try parseViewport(globalObject, viewport_obj, &viewport);
        
        this.viewport = viewport;

        // Send CDP Emulation.setDeviceMetricsOverride
        return JSValue.jsUndefined();
    }

    pub fn close(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        _ = callFrame;
        _ = globalObject;
        
        if (!this.is_closed) {
            this.is_closed = true;
            // Send CDP Target.closeTarget
        }
        
        return JSValue.jsUndefined();
    }

    pub fn getIsClosed(this: *Page, globalObject: *JSGlobalObject) JSValue {
        _ = globalObject;
        return JSValue.jsBoolean(this.is_closed);
    }

    // Helper functions
    fn parseNavigationOptions(globalObject: *JSGlobalObject, obj: JSValue, options: *NavigationOptions) !void {
        _ = globalObject;
        _ = obj;
        _ = options;
        // Parse timeout, waitUntil, referer options
    }

    fn parseScreenshotOptions(globalObject: *JSGlobalObject, obj: JSValue, options: *ScreenshotOptions) !void {
        _ = globalObject;
        _ = obj;
        _ = options;
        // Parse screenshot options
    }

    fn parseViewport(globalObject: *JSGlobalObject, obj: JSValue, viewport: *Viewport) !void {
        if (obj.get(globalObject, "width")) |width| {
            if (width.isNumber()) {
                viewport.width = @intFromFloat(width.asNumber());
            }
        }

        if (obj.get(globalObject, "height")) |height| {
            if (height.isNumber()) {
                viewport.height = @intFromFloat(height.asNumber());
            }
        }

        if (obj.get(globalObject, "deviceScaleFactor")) |dsf| {
            if (dsf.isNumber()) {
                viewport.device_scale_factor = dsf.asNumber();
            }
        }

        if (obj.get(globalObject, "isMobile")) |mobile| {
            if (mobile.isBoolean()) {
                viewport.is_mobile = mobile.toBoolean();
            }
        }

        if (obj.get(globalObject, "hasTouch")) |touch| {
            if (touch.isBoolean()) {
                viewport.has_touch = touch.toBoolean();
            }
        }

        if (obj.get(globalObject, "isLandscape")) |landscape| {
            if (landscape.isBoolean()) {
                viewport.is_landscape = landscape.toBoolean();
            }
        }
    }

    fn generateTargetId(allocator: Allocator) ![]const u8 {
        // Generate a unique target ID
        const random = std.crypto.random;
        var bytes: [16]u8 = undefined;
        random.bytes(&bytes);
        
        return try std.fmt.allocPrint(allocator, "{x}", .{std.fmt.fmtSliceHexLower(&bytes)});
    }

    fn generateSessionId(allocator: Allocator) ![]const u8 {
        // Generate a unique session ID
        const random = std.crypto.random;
        var bytes: [16]u8 = undefined;
        random.bytes(&bytes);
        
        return try std.fmt.allocPrint(allocator, "{x}", .{std.fmt.fmtSliceHexLower(&bytes)});
    }

    pub fn deinit(this: *Page) void {
        // Clean up target and session IDs
        this.allocator.free(this.target_id);
        this.allocator.free(this.session_id);
        
        // Clean up URL
        if (this.url_value.len > 0 and !std.mem.eql(u8, this.url_value, "about:blank")) {
            this.allocator.free(this.url_value);
        }
        
        // Clean up frame ID
        if (this.frame_id) |frame_id| {
            this.allocator.free(frame_id);
        }

        // Clean up input interfaces
        if (this.keyboard_interface) |keyboard| {
            keyboard.deinit();
        }
        if (this.mouse_interface) |mouse| {
            mouse.deinit();
        }
        if (this.touchscreen_interface) |touchscreen| {
            touchscreen.deinit();
        }
    }

    pub fn finalize(this: *Page) void {
        this.deinit();
        bun.destroy(this);
    }
};

// Forward declarations for input interfaces
pub const Keyboard = struct {
    pub fn create(globalObject: *JSGlobalObject, page: *Page) !*Keyboard {
        _ = globalObject;
        _ = page;
        @panic("Keyboard.create not implemented yet");
    }
    
    pub fn toJS(this: *Keyboard, globalObject: *JSGlobalObject) JSValue {
        _ = this;
        _ = globalObject;
        @panic("Keyboard.toJS not implemented yet");
    }
    
    pub fn deinit(this: *Keyboard) void {
        _ = this;
    }
};

pub const Mouse = struct {
    pub fn create(globalObject: *JSGlobalObject, page: *Page) !*Mouse {
        _ = globalObject;
        _ = page;
        @panic("Mouse.create not implemented yet");
    }
    
    pub fn toJS(this: *Mouse, globalObject: *JSGlobalObject) JSValue {
        _ = this;
        _ = globalObject;
        @panic("Mouse.toJS not implemented yet");
    }
    
    pub fn deinit(this: *Mouse) void {
        _ = this;
    }
};

pub const Touchscreen = struct {
    pub fn create(globalObject: *JSGlobalObject, page: *Page) !*Touchscreen {
        _ = globalObject;
        _ = page;
        @panic("Touchscreen.create not implemented yet");
    }
    
    pub fn toJS(this: *Touchscreen, globalObject: *JSGlobalObject) JSValue {
        _ = this;
        _ = globalObject;
        @panic("Touchscreen.toJS not implemented yet");
    }
    
    pub fn deinit(this: *Touchscreen) void {
        _ = this;
    }
};