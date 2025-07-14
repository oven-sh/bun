// Bun.Browser - Chrome DevTools Protocol based browser automation
// This replaces Puppeteer with a native Bun implementation

define({
  name: "Browser",
  constructor: true,
  JSType: "object",
  finalize: true,
  proto: {
    launch: {
      // Static method to launch a new browser instance
      args: 1,
    },
    newPage: {
      // Create a new page/tab
      args: 0,
    },
    pages: {
      // Get all open pages
      args: 0,
    },
    close: {
      // Close the browser
      args: 0,
    },
    disconnect: {
      // Disconnect from browser without closing
      args: 0,
    },
    isConnected: {
      // Check if browser is connected
      getter: true,
    },
    process: {
      // Get the browser process
      getter: true,
    },
    wsEndpoint: {
      // Get WebSocket endpoint URL
      getter: true,
    },
    version: {
      // Get browser version info
      args: 0,
    },
  },
});

define({
  name: "Page",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    goto: {
      // Navigate to URL
      args: 2,
    },
    goBack: {
      // Navigate back
      args: 1,
    },
    goForward: {
      // Navigate forward
      args: 1,
    },
    reload: {
      // Reload page
      args: 1,
    },
    content: {
      // Get page HTML content
      args: 0,
    },
    setContent: {
      // Set page HTML content
      args: 2,
    },
    title: {
      // Get page title
      args: 0,
    },
    url: {
      // Get current URL
      getter: true,
    },
    evaluate: {
      // Execute JavaScript in page context
      args: 2,
    },
    evaluateHandle: {
      // Execute JavaScript and return JSHandle
      args: 2,
    },
    querySelector: {
      // Find element by selector
      args: 1,
    },
    querySelectorAll: {
      // Find all elements by selector
      args: 1,
    },
    click: {
      // Click element
      args: 2,
    },
    type: {
      // Type text into element
      args: 3,
    },
    keyboard: {
      // Get keyboard interface
      getter: true,
      cache: true,
    },
    mouse: {
      // Get mouse interface
      getter: true,
      cache: true,
    },
    touchscreen: {
      // Get touchscreen interface
      getter: true,
      cache: true,
    },
    screenshot: {
      // Take screenshot
      args: 1,
    },
    pdf: {
      // Generate PDF
      args: 1,
    },
    emulate: {
      // Emulate device
      args: 1,
    },
    setViewport: {
      // Set viewport size
      args: 1,
    },
    viewport: {
      // Get current viewport
      getter: true,
    },
    waitForSelector: {
      // Wait for selector to appear
      args: 2,
    },
    waitForTimeout: {
      // Wait for timeout
      args: 1,
    },
    waitForNavigation: {
      // Wait for navigation
      args: 1,
    },
    waitForFunction: {
      // Wait for function to return truthy
      args: 2,
    },
    setCookie: {
      // Set cookies
      args: 1,
    },
    cookies: {
      // Get cookies
      args: 1,
    },
    deleteCookie: {
      // Delete cookies
      args: 1,
    },
    addScriptTag: {
      // Add script tag
      args: 1,
    },
    addStyleTag: {
      // Add style tag
      args: 1,
    },
    setExtraHTTPHeaders: {
      // Set extra HTTP headers
      args: 1,
    },
    setUserAgent: {
      // Set user agent
      args: 1,
    },
    close: {
      // Close the page
      args: 0,
    },
    isClosed: {
      // Check if page is closed
      getter: true,
    },
    mainFrame: {
      // Get main frame
      getter: true,
    },
    frames: {
      // Get all frames
      args: 0,
    },
    on: {
      // Add event listener
      args: 2,
    },
    off: {
      // Remove event listener
      args: 2,
    },
    once: {
      // Add one-time event listener
      args: 2,
    },
    coverage: {
      // Get coverage interface
      getter: true,
      cache: true,
    },
    accessibility: {
      // Get accessibility interface
      getter: true,
      cache: true,
    },
  },
});

define({
  name: "ElementHandle",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    click: {
      // Click the element
      args: 1,
    },
    hover: {
      // Hover over element
      args: 0,
    },
    focus: {
      // Focus the element
      args: 0,
    },
    type: {
      // Type text into element
      args: 2,
    },
    press: {
      // Press key
      args: 2,
    },
    boundingBox: {
      // Get element bounding box
      args: 0,
    },
    screenshot: {
      // Take element screenshot
      args: 1,
    },
    getAttribute: {
      // Get attribute value
      args: 1,
    },
    getProperty: {
      // Get property value
      args: 1,
    },
    select: {
      // Select options
      args: 1,
    },
    uploadFile: {
      // Upload files
      args: 1,
    },
    tap: {
      // Tap element (touch)
      args: 0,
    },
    isIntersectingViewport: {
      // Check if element is in viewport
      args: 1,
    },
    dispose: {
      // Dispose the handle
      args: 0,
    },
  },
});

define({
  name: "Keyboard",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    down: {
      // Press key down
      args: 2,
    },
    up: {
      // Release key
      args: 1,
    },
    press: {
      // Press and release key
      args: 2,
    },
    type: {
      // Type text
      args: 2,
    },
    sendCharacter: {
      // Send character
      args: 1,
    },
  },
});

define({
  name: "Mouse",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    move: {
      // Move mouse to coordinates
      args: 3,
    },
    click: {
      // Click at coordinates
      args: 3,
    },
    down: {
      // Press mouse button
      args: 1,
    },
    up: {
      // Release mouse button
      args: 1,
    },
    wheel: {
      // Scroll wheel
      args: 1,
    },
    drag: {
      // Drag from one point to another
      args: 2,
    },
    dragAndDrop: {
      // Drag and drop
      args: 2,
    },
  },
});

define({
  name: "Touchscreen",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    tap: {
      // Tap at coordinates
      args: 2,
    },
    touchStart: {
      // Start touch
      args: 1,
    },
    touchMove: {
      // Move touch
      args: 1,
    },
    touchEnd: {
      // End touch
      args: 0,
    },
  },
});

define({
  name: "JSHandle",
  constructor: false,
  JSType: "object",
  finalize: true,
  proto: {
    evaluate: {
      // Evaluate function with handle
      args: 2,
    },
    evaluateHandle: {
      // Evaluate function and return handle
      args: 2,
    },
    getProperty: {
      // Get property
      args: 1,
    },
    getProperties: {
      // Get all properties
      args: 0,
    },
    jsonValue: {
      // Get JSON value
      args: 0,
    },
    asElement: {
      // Cast to ElementHandle if possible
      args: 0,
    },
    dispose: {
      // Dispose the handle
      args: 0,
    },
  },
});