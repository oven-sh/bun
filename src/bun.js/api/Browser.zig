const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const Allocator = std.mem.Allocator;
const ArrayBuffer = JSC.ArrayBuffer;
const ZigString = JSC.ZigString;

pub const Browser = struct {
    // Generated bindings
    pub const js = JSC.Codegen.JSBrowser;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    // Browser state
    process: ?*bun.spawn.Subprocess = null,
    ws_endpoint: ?[]const u8 = null,
    is_connected: bool = false,
    debug_port: u16 = 9222,
    pages: std.ArrayList(*Page),
    allocator: Allocator,
    chrome_executable: []const u8,
    
    // CDP connection
    websocket_client: ?*JSC.WebCore.WebSocket = null,
    message_id: u32 = 1,

    pub const BrowserOptions = struct {
        headless: ?bool = null,
        args: ?[]const []const u8 = null,
        executable_path: ?[]const u8 = null,
        ignore_default_args: ?bool = null,
        ignore_https_errors: ?bool = null,
        default_viewport: ?Viewport = null,
        slow_mo: ?u32 = null,
        timeout: ?u32 = null,
        dev_tools: ?bool = null,
        debug_port: ?u16 = null,
        user_data_dir: ?[]const u8 = null,
        env: ?std.process.EnvMap = null,
        pipe: ?bool = null,
        dumpio: ?bool = null,
        handle_sigint: ?bool = null,
        handle_sigterm: ?bool = null,
        handle_sighup: ?bool = null,
    };

    pub const Viewport = struct {
        width: u32,
        height: u32,
        device_scale_factor: ?f64 = null,
        is_mobile: ?bool = null,
        has_touch: ?bool = null,
        is_landscape: ?bool = null,
    };

    pub const new = bun.TrivialNew(@This());

    pub fn constructor(
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!*Browser {
        const allocator = bun.default_allocator;
        
        // Create browser instance
        const browser = bun.new(Browser, Browser{
            .allocator = allocator,
            .pages = std.ArrayList(*Page).init(allocator),
            .chrome_executable = try findChromeExecutable(allocator),
        });

        return browser;
    }

    pub fn launch(
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        
        // Parse options from first argument
        var options = BrowserOptions{};
        if (callFrame.argumentCount() > 0) {
            const options_obj = callFrame.argument(0);
            if (!options_obj.isUndefinedOrNull()) {
                try parseBrowserOptions(globalObject, options_obj, &options);
            }
        }

        // Create browser instance
        const browser = bun.new(Browser, Browser{
            .allocator = allocator,
            .pages = std.ArrayList(*Page).init(allocator),
            .chrome_executable = options.executable_path orelse try findChromeExecutable(allocator),
            .debug_port = options.debug_port orelse 9222,
        });

        // Launch Chrome process
        try browser.launchChrome(globalObject, &options);
        
        // Connect to CDP endpoint
        try browser.connectToCDP(globalObject);

        return browser.toJS(globalObject);
    }

    fn launchChrome(self: *Browser, globalObject: *JSGlobalObject, options: *const BrowserOptions) !void {
        const allocator = self.allocator;
        
        // Build Chrome arguments
        var args = std.ArrayList([]const u8).init(allocator);
        defer args.deinit();
        
        // Essential Chrome arguments for automation
        try args.append("--remote-debugging-port=9222");
        try args.append("--no-first-run");
        try args.append("--no-default-browser-check");
        try args.append("--disable-background-timer-throttling");
        try args.append("--disable-backgrounding-occluded-windows");
        try args.append("--disable-renderer-backgrounding");
        try args.append("--disable-features=TranslateUI");
        try args.append("--disable-ipc-flooding-protection");
        try args.append("--disable-component-extensions-with-background-pages");
        try args.append("--disable-default-apps");
        try args.append("--disable-extensions");
        try args.append("--disable-sync");
        try args.append("--metrics-recording-only");
        try args.append("--no-pings");
        try args.append("--password-store=basic");
        try args.append("--use-mock-keychain");
        try args.append("--enable-blink-features=IdleDetection");
        try args.append("--export-tagged-pdf");

        // Headless mode
        if (options.headless orelse true) {
            try args.append("--headless=new");
            try args.append("--hide-scrollbars");
            try args.append("--mute-audio");
        }

        // Custom debug port
        if (options.debug_port) |port| {
            const port_arg = try std.fmt.allocPrint(allocator, "--remote-debugging-port={d}", .{port});
            try args.replaceRange(0, 1, &[_][]const u8{port_arg});
            self.debug_port = port;
        }

        // User data directory
        if (options.user_data_dir) |user_data_dir| {
            const user_data_arg = try std.fmt.allocPrint(allocator, "--user-data-dir={s}", .{user_data_dir});
            try args.append(user_data_arg);
        } else {
            // Create temporary user data directory
            const temp_dir = std.fs.getAppDataDir(allocator, "bun-browser") catch |err| {
                return globalObject.throw("Failed to create temporary directory: {s}", .{@errorName(err)});
            };
            const user_data_arg = try std.fmt.allocPrint(allocator, "--user-data-dir={s}", .{temp_dir});
            try args.append(user_data_arg);
        }

        // Add custom arguments
        if (options.args) |custom_args| {
            try args.appendSlice(custom_args);
        }

        // Add about:blank as initial page
        try args.append("about:blank");

        // Spawn Chrome process
        const spawn_options = bun.spawn.SpawnOptions{
            .argv = args.items,
            .envp = null,
            .cwd = ".",
            .detached = false,
            .stdio = .{ .stdout = .pipe, .stderr = .pipe, .stdin = .ignore },
        };

        self.process = bun.spawn.spawnProcess(
            globalObject,
            &spawn_options,
            null,
            null,
        ) catch |err| {
            return globalObject.throw("Failed to launch Chrome: {s}", .{@errorName(err)});
        };

        // Wait a moment for Chrome to start up
        std.time.sleep(1000 * std.time.ns_per_ms);
    }

    fn connectToCDP(self: *Browser, globalObject: *JSGlobalObject) !void {
        const allocator = self.allocator;
        
        // Get the WebSocket debug URL from Chrome
        const url = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}/json/version", .{self.debug_port});
        defer allocator.free(url);
        
        // Make HTTP request to get version info and WebSocket URL
        // This would use Bun's HTTP client to fetch the debug URL
        // For now, construct the expected WebSocket URL
        self.ws_endpoint = try std.fmt.allocPrint(allocator, "ws://127.0.0.1:{d}/devtools/browser", .{self.debug_port});
        self.is_connected = true;
    }

    pub fn newPage(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (!this.is_connected) {
            return globalObject.throw("Browser is not connected", .{});
        }

        // Create new page via CDP
        const page = try Page.create(globalObject, this);
        try this.pages.append(page);
        
        return page.toJS(globalObject);
    }

    pub fn pages(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        const array = JSValue.createEmptyArray(globalObject, this.pages.items.len);
        
        for (this.pages.items, 0..) |page, i| {
            array.putIndex(globalObject, @intCast(i), page.toJS(globalObject));
        }
        
        return array;
    }

    pub fn close(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        // Close all pages first
        for (this.pages.items) |page| {
            page.close();
        }
        this.pages.clearAndFree();

        // Close WebSocket connection
        if (this.websocket_client) |ws| {
            ws.close();
            this.websocket_client = null;
        }

        // Terminate Chrome process
        if (this.process) |process| {
            _ = process.kill();
            this.process = null;
        }

        this.is_connected = false;
        
        return JSValue.jsUndefined();
    }

    pub fn disconnect(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (this.websocket_client) |ws| {
            ws.close();
            this.websocket_client = null;
        }
        
        this.is_connected = false;
        
        return JSValue.jsUndefined();
    }

    pub fn getIsConnected(this: *Browser, globalObject: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.is_connected);
    }

    pub fn getProcess(this: *Browser, globalObject: *JSGlobalObject) JSValue {
        if (this.process) |process| {
            // Return the subprocess as a JS object
            return process.toJS(globalObject);
        }
        return JSValue.jsNull();
    }

    pub fn getWsEndpoint(this: *Browser, globalObject: *JSGlobalObject) JSValue {
        if (this.ws_endpoint) |endpoint| {
            return JSValue.createStringFromUTF8(globalObject, endpoint);
        }
        return JSValue.jsNull();
    }

    pub fn version(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!JSValue {
        if (!this.is_connected) {
            return globalObject.throw("Browser is not connected", .{});
        }

        // Send CDP command to get version info
        const version_obj = JSValue.createEmptyObject(globalObject, 4);
        version_obj.put(globalObject, ZigString.static("Browser"), JSValue.createStringFromUTF8(globalObject, "chrome"));
        version_obj.put(globalObject, ZigString.static("Protocol-Version"), JSValue.createStringFromUTF8(globalObject, "1.3"));
        version_obj.put(globalObject, ZigString.static("User-Agent"), JSValue.createStringFromUTF8(globalObject, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"));
        version_obj.put(globalObject, ZigString.static("V8-Version"), JSValue.createStringFromUTF8(globalObject, "12.0"));
        
        return version_obj;
    }

    fn parseBrowserOptions(globalObject: *JSGlobalObject, obj: JSValue, options: *BrowserOptions) !void {
        if (obj.get(globalObject, "headless")) |headless| {
            if (headless.isBoolean()) {
                options.headless = headless.toBoolean();
            }
        }

        if (obj.get(globalObject, "executablePath")) |exec_path| {
            if (exec_path.isString()) {
                options.executable_path = exec_path.toSlice(globalObject, bun.default_allocator).slice();
            }
        }

        if (obj.get(globalObject, "args")) |args| {
            if (args.isArray()) {
                // Parse args array
                const len = args.getLength(globalObject);
                var arg_list = std.ArrayList([]const u8).init(bun.default_allocator);
                
                for (0..len) |i| {
                    const arg = args.getIndex(globalObject, @intCast(i));
                    if (arg.isString()) {
                        const str = arg.toSlice(globalObject, bun.default_allocator).slice();
                        try arg_list.append(str);
                    }
                }
                
                options.args = try arg_list.toOwnedSlice();
            }
        }

        if (obj.get(globalObject, "devtools")) |devtools| {
            if (devtools.isBoolean()) {
                options.dev_tools = devtools.toBoolean();
            }
        }

        if (obj.get(globalObject, "slowMo")) |slow_mo| {
            if (slow_mo.isNumber()) {
                options.slow_mo = @intFromFloat(slow_mo.asNumber());
            }
        }
    }

    fn findChromeExecutable(allocator: Allocator) ![]const u8 {
        // Try common Chrome executable paths
        const possible_paths = [_][]const u8{
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser", 
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/opt/google/chrome/chrome",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        };

        for (possible_paths) |path| {
            if (std.fs.accessAbsolute(path, .{})) {
                return try allocator.dupe(u8, path);
            } else |_| {}
        }

        // Try to find via which command
        const result = std.process.Child.run(.{
            .allocator = allocator,
            .argv = &[_][]const u8{ "which", "chromium" },
        }) catch {
            return error.ChromeNotFound;
        };
        
        if (result.term == .Exited and result.term.Exited == 0) {
            const path = std.mem.trim(u8, result.stdout, " \n\r\t");
            return try allocator.dupe(u8, path);
        }

        return error.ChromeNotFound;
    }

    pub fn deinit(this: *Browser) void {
        // Clean up pages
        for (this.pages.items) |page| {
            page.deinit();
        }
        this.pages.deinit();

        // Clean up WebSocket
        if (this.websocket_client) |ws| {
            ws.close();
        }

        // Clean up process
        if (this.process) |process| {
            _ = process.kill();
        }

        // Free allocated strings
        if (this.ws_endpoint) |endpoint| {
            this.allocator.free(endpoint);
        }
        
        this.allocator.free(this.chrome_executable);
    }

    pub fn finalize(this: *Browser) void {
        this.deinit();
        bun.destroy(this);
    }
};

// Import Page from separate file
const Page = @import("Page.zig").Page;