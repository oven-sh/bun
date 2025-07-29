# Browser Use API Implementation Plan for Bun

## Overview

This document outlines a comprehensive plan for implementing a browser automation API in Bun, similar to Puppeteer. The API will provide high-performance browser control through the Chrome DevTools Protocol (CDP), leveraging Bun's existing process management, WebSocket client infrastructure, and JavaScriptCore bindings.

## Goals

- **Performance**: Native-speed browser automation with minimal overhead
- **Compatibility**: Puppeteer-like API for easy migration from existing tools
- **Integration**: Seamless integration with Bun's ecosystem and existing APIs
- **Reliability**: Robust process management and error handling
- **Cross-platform**: Support for Linux, macOS, and Windows

## Architecture Overview

The implementation will consist of several key components:

1. **BrowserLauncher** - Manages Chromium process lifecycle
2. **Browser** - Represents a browser instance
3. **Page** - Represents a browser tab/page
4. **Element** - Represents DOM elements
5. **CDP Client** - Handles DevTools Protocol communication
6. **Input Simulator** - Handles mouse/keyboard events

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Browser Process Management

**Files to create:**
- `src/bun.js/api/bun/browser_launcher.zig` - Main browser launcher implementation
- `src/bun.js/api/BrowserLauncher.classes.ts` - JavaScript class definitions
- `src/bun.js/api/bun/browser_paths.zig` - Browser executable discovery

**Key Features:**
- Browser executable discovery (Chrome, Chromium, Edge)
- Process spawning with proper arguments
- CDP endpoint discovery via HTTP API
- Process lifecycle management
- Automatic cleanup on exit

**Browser Discovery Logic:**
```zig
pub const BrowserPaths = struct {
    pub fn findChrome() ?[]const u8 {
        // Linux: chromium-browser, chromium, chrome
        // macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
        // Windows: chrome.exe in Program Files
    }
    
    pub fn findEdge() ?[]const u8 {
        // Edge executable paths by platform
    }
};
```

**Process Management Pattern (following subprocess.zig):**
```zig
pub const BrowserLauncher = struct {
    ref_count: RefCount,
    process: *Subprocess,
    cdp_port: u16,
    browser_type: BrowserType,
    globalThis: *JSC.JSGlobalObject,
    
    pub fn launch(options: LaunchOptions) !*BrowserLauncher {
        // 1. Find browser executable
        // 2. Generate CDP arguments
        // 3. Spawn process with Subprocess
        // 4. Discover CDP endpoint
        // 5. Return launcher instance
    }
    
    pub fn close(this: *BrowserLauncher) !void {
        // Graceful browser shutdown
    }
};
```

#### 1.2 CDP Communication Layer

**Files to leverage:**
- `packages/bun-inspector-protocol/src/inspector/websocket.ts` - Existing WebSocket inspector
- `src/http/websocket_client.zig` - WebSocket client implementation

**Files to create:**
- `src/bun.js/api/bun/cdp_client.zig` - CDP message handling
- `src/bun.js/api/CDPClient.classes.ts` - JavaScript bindings

**CDP Client Architecture:**
```zig
pub const CDPClient = struct {
    websocket: *WebSocket,
    pending_requests: HashMap(u32, *CDPRequest),
    event_handlers: HashMap([]const u8, fn(*CDPEvent) void),
    request_id: std.atomic.Value(u32),
    
    pub fn connect(endpoint_url: []const u8) !*CDPClient {
        // Connect to CDP WebSocket endpoint
    }
    
    pub fn sendCommand(method: []const u8, params: ?JSValue) !JSValue {
        // Send CDP command and await response
    }
    
    pub fn on(event_name: []const u8, handler: fn(*CDPEvent) void) void {
        // Register event handler
    }
};
```

#### 1.3 JavaScript Class Bindings

**Browser Class Definition:**
```typescript
// BrowserLauncher.classes.ts
define({
  name: "Browser",
  construct: true,
  finalize: true,
  hasPendingActivity: true,
  proto: {
    newPage: { fn: "newPage", length: 0 },
    pages: { fn: "pages", length: 0 },
    close: { fn: "close", length: 0 },
    version: { getter: "getVersion", cache: true },
    wsEndpoint: { getter: "getWSEndpoint", cache: true },
    "@@asyncDispose": { fn: "asyncDispose", length: 0 },
  },
});

define({
  name: "Page", 
  construct: true,
  finalize: true,
  proto: {
    goto: { fn: "goto", length: 1 },
    evaluate: { fn: "evaluate", length: 1 },
    $: { fn: "querySelector", length: 1 },
    $$: { fn: "querySelectorAll", length: 1 },
    click: { fn: "click", length: 1 },
    type: { fn: "type", length: 2 },
    screenshot: { fn: "screenshot", length: 1 },
    reload: { fn: "reload", length: 1 },
    close: { fn: "close", length: 0 },
    url: { getter: "getURL" },
    title: { getter: "getTitle" },
  },
  values: ["loadPromise", "errorCallback"],
});
```

### Phase 2: High-Level Browser API

#### 2.1 Browser Class Implementation

**Core Browser Management:**
```zig
pub const Browser = struct {
    pub const js = JSC.Codegen.JSBrowser;
    
    launcher: *BrowserLauncher,
    cdp_client: *CDPClient,
    pages: ArrayList(*Page),
    default_context: *BrowserContext,
    
    pub fn constructor(
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!*Browser {
        // Initialize browser with launch options
    }
    
    pub fn newPage(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // Create new page via CDP Target.createTarget
    }
    
    pub fn close(
        this: *Browser,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // Gracefully close all pages and browser process
    }
};
```

#### 2.2 Page Class Implementation

**Page Navigation & Control:**
```zig
pub const Page = struct {
    pub const js = JSC.Codegen.JSPage;
    
    browser: *Browser,
    target_id: []const u8,
    cdp_session: *CDPSession,
    dom_world: *DOMWorld,
    
    pub fn goto(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const url = callFrame.argument(0).toSlice(globalObject);
        // Send Page.navigate command
        return this.cdp_session.sendCommand("Page.navigate", .{ .url = url });
    }
    
    pub fn evaluate(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const expression = callFrame.argument(0).toSlice(globalObject);
        // Send Runtime.evaluate command
        return this.cdp_session.sendCommand("Runtime.evaluate", .{
            .expression = expression,
            .returnByValue = true,
        });
    }
    
    pub fn screenshot(
        this: *Page,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // Send Page.captureScreenshot command
        // Return Buffer with image data
    }
};
```

#### 2.3 Element Handling

**DOM Element Abstraction:**
```zig
pub const Element = struct {
    pub const js = JSC.Codegen.JSElement;
    
    page: *Page,
    node_id: u32,
    remote_object_id: ?[]const u8,
    
    pub fn click(
        this: *Element,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // 1. Get element box model
        // 2. Calculate click coordinates
        // 3. Send Input.dispatchMouseEvent
    }
    
    pub fn type(
        this: *Element,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const text = callFrame.argument(0).toSlice(globalObject);
        // Focus element and send Input.insertText
    }
};
```

### Phase 3: Advanced Features

#### 3.1 Input Simulation

**Mouse and Keyboard Events:**
```zig
pub const InputManager = struct {
    page: *Page,
    
    pub fn click(this: *InputManager, x: f64, y: f64, options: ClickOptions) !void {
        // Send mouse press and release events
    }
    
    pub fn type(this: *InputManager, text: []const u8, options: TypeOptions) !void {
        // Send individual key events for each character
    }
    
    pub fn keyboard(this: *InputManager, key: []const u8, options: KeyOptions) !void {
        // Send keyboard events (keyDown, keyUp)
    }
};
```

#### 3.2 Network Interception

**Request/Response Monitoring:**
```zig
pub const NetworkManager = struct {
    page: *Page,
    request_handlers: ArrayList(*RequestHandler),
    
    pub fn setRequestInterception(this: *NetworkManager, enabled: bool) !void {
        // Enable/disable Network.setRequestInterception
    }
    
    pub fn onRequest(this: *NetworkManager, handler: *RequestHandler) void {
        // Register request interception handler
    }
};
```

#### 3.3 Screenshot and PDF Generation

**Page Capture:**
```zig
pub const CaptureManager = struct {
    page: *Page,
    
    pub fn screenshot(this: *CaptureManager, options: ScreenshotOptions) ![]u8 {
        // Page.captureScreenshot with format/quality options
    }
    
    pub fn pdf(this: *CaptureManager, options: PDFOptions) ![]u8 {
        // Page.printToPDF with page settings
    }
};
```

### Phase 4: Integration and Testing

#### 4.1 Bun Module Registration

**Module Export:**
```zig
// In BunObject.zig
pub const Browser = toJSCallback(host_fn.wrapStaticMethod(api.Browser, "launch", false));

// Register in generated_classes_list.zig
BrowserLauncher: type = *api.BrowserLauncher,
Browser: type = *api.Browser,
Page: type = *api.Page,
Element: type = *api.Element,
```

**JavaScript API:**
```typescript
// Global Bun object
declare global {
  namespace Bun {
    function browser(options?: BrowserLaunchOptions): Promise<Browser>;
  }
}

interface BrowserLaunchOptions {
  headless?: boolean | "shell";
  executablePath?: string;
  args?: string[];
  timeout?: number;
  dumpio?: boolean;
}

interface Browser {
  newPage(): Promise<Page>;
  pages(): Promise<Page[]>;
  close(): Promise<void>;
  version(): Promise<string>;
  wsEndpoint(): string;
}

interface Page {
  goto(url: string, options?: NavigationOptions): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  $(selector: string): Promise<Element | null>;
  $$(selector: string): Promise<Element[]>;
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  close(): Promise<void>;
  url(): string;
  title(): string;
}
```

#### 4.2 Error Handling and Cleanup

**Resource Management:**
```zig
pub fn finalize(this: *Browser) void {
    JSC.markBinding(@src());
    // Close all pages
    for (this.pages.items) |page| {
        page.close();
    }
    // Close CDP connection
    this.cdp_client.close();
    // Terminate browser process
    this.launcher.close();
    // Free memory
    this.deinit();
}
```

**Error Propagation:**
```zig
pub fn handleCDPError(error_response: CDPErrorResponse) bun.JSError {
    return switch (error_response.code) {
        -32000 => bun.JSError.fromString("CDP: Invalid request"),
        -32001 => bun.JSError.fromString("CDP: Method not found"),
        else => bun.JSError.fromString("CDP: Unknown error"),
    };
}
```

#### 4.3 Testing Strategy

**Unit Tests:**
- Browser executable discovery
- CDP message serialization/deserialization
- Process lifecycle management
- WebSocket connection handling

**Integration Tests:**
- Full browser launch and page navigation
- Element interaction and evaluation
- Screenshot and PDF generation
- Network request interception
- Error handling and recovery

**Performance Tests:**
- Browser launch time
- Page navigation speed
- Memory usage during long sessions
- Concurrent page handling

## Implementation Timeline

### Week 1-2: Core Infrastructure
- Browser process management
- CDP client implementation
- Basic WebSocket communication
- JavaScript class bindings

### Week 3-4: High-Level API
- Browser and Page classes
- Navigation and evaluation
- Element handling
- Basic input simulation

### Week 5-6: Advanced Features
- Screenshot/PDF generation
- Network interception
- Enhanced input simulation
- Error handling improvements

### Week 7-8: Testing and Polish
- Comprehensive test suite
- Performance optimization
- Documentation
- Cross-platform testing

## Technical Considerations

### Performance Optimizations
- **Connection Pooling**: Reuse CDP connections where possible
- **Message Batching**: Batch multiple CDP commands when feasible
- **Memory Management**: Proper cleanup of DOM references and event listeners
- **Stream Processing**: Use Bun's efficient stream handling for large responses

### Cross-Platform Support
- **Browser Discovery**: Platform-specific executable paths
- **Process Management**: Handle different signal behaviors
- **File Paths**: Use proper path separators and conventions
- **Dependencies**: Minimize external dependencies

### Security Considerations
- **Sandbox Execution**: Run browsers with appropriate security flags
- **Resource Limits**: Implement timeouts and memory limits
- **Input Validation**: Sanitize all user inputs before CDP commands

## Dependencies and Requirements

### Existing Bun Infrastructure
- ✅ Subprocess API (process management)
- ✅ WebSocket client (CDP communication)
- ✅ JavaScriptCore bindings (JavaScript API)
- ✅ Event loop integration (async operations)
- ✅ Inspector protocol (CDP message types)

### New Components Required
- Browser executable discovery
- CDP endpoint discovery
- High-level DOM abstraction
- Input event simulation
- Screenshot/PDF handling

## Success Metrics

1. **API Compatibility**: 80%+ compatibility with Puppeteer's core API
2. **Performance**: 2x faster than Node.js + Puppeteer for common operations
3. **Memory Usage**: 50% less memory overhead than comparable solutions
4. **Reliability**: 99%+ success rate for browser launch and basic operations
5. **Developer Experience**: Simple, well-documented API with TypeScript support

## Future Enhancements

### Phase 2 Features
- Browser extension support
- Multiple browser contexts
- Service worker interception
- Advanced debugging features

### Performance Improvements
- Browser instance pooling
- Persistent browser sessions
- WebDriver BiDi protocol support
- Native binary protocol for high-throughput scenarios

This implementation plan provides a comprehensive roadmap for building a high-performance browser automation API in Bun, leveraging existing infrastructure while providing a familiar developer experience.