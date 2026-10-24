// Members of host classes that do what every function of the host may do with its operands and change none of them, with what test/aot/builtins/native-contract.test.ts saw of each on an instance of its class: the sets of operands it was called with, the calls that returned, and what it did with an object in each position of its arguments.
type Calls = { sets: number; returned: number };
type Members = {
  methods: Readonly<Record<string, Calls & { taken: readonly number[]; refused: readonly number[] }>>;
  getters: Readonly<Record<string, Calls>>;
  accessors: Readonly<Record<string, Calls>>;
};

export const membersChangingNothing: Readonly<Record<string, Members>> = {
  "%DNSResolver%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%DebugHTTPSServer%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%DebugHTTPServer%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%HTTPSServer%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%HTTPServer%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%Listener%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%NodeHTTPResponse%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%NodeJSFS%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%Subprocess%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%TCPSocket%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%TLSSocket%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%UDPSocket%": {
    methods: {
      setBroadcast: { sets: 189, returned: 184, taken: [0], refused: [] },
      setMulticastLoopback: { sets: 189, returned: 184, taken: [0], refused: [] },
    },
    getters: {},
    accessors: {},
  },
  "%BlockList%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%H2FrameParser%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%ServerWebSocket%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  "%SocketAddress%": {
    methods: {},
    getters: {},
    accessors: {},
  },
  BuildMessage: {
    methods: {},
    getters: {},
    accessors: {},
  },
  ResolveMessage: {
    methods: {},
    getters: {},
    accessors: {},
  },
};

// The same for native bindings.
type Binding = Calls & { functions: number; taken: readonly number[]; refused: readonly number[] };

export const bindingsChangingNothing: Readonly<Record<string, Binding>> = {
  "native:Cpp:NodeURL.cpp:Bun::createNodeICUBinding": {
    functions: 2,
    sets: 520,
    returned: 518,
    taken: [0],
    refused: [],
  },
  "native:Cpp:NodeURL.cpp:Bun::createNodeURLBinding": {
    functions: 3,
    sets: 780,
    returned: 777,
    taken: [0],
    refused: [],
  },
  "native:Cpp:NodeV8.cpp:Bun::createNodeV8Binding": {
    functions: 4,
    sets: 1040,
    returned: 786,
    taken: [0, 1],
    refused: [],
  },
  "native:NewCppFunction:JSEventTargetNode.cpp:jsFunctionNodeEventsGetEventListeners": {
    functions: 1,
    sets: 252,
    returned: 4,
    taken: [0, 1],
    refused: [],
  },
  "native:NewCppFunction:JSInspectorProfiler.cpp:jsFunction_isCPUProfilerRunning": {
    functions: 1,
    sets: 192,
    returned: 192,
    taken: [],
    refused: [],
  },
  "native:NewCppFunction:JSInspectorProfiler.cpp:jsFunction_setCPUSamplingInterval": {
    functions: 1,
    sets: 324,
    returned: 74,
    taken: [],
    refused: [0],
  },
  "native:NewCppFunction:JSNodePerformanceHooksHistogram.cpp:jsFunction_createHistogram": {
    functions: 1,
    sets: 830,
    returned: 638,
    taken: [],
    refused: [],
  },
  "native:NewCppFunction:JSNodePerformanceHooksHistogramPrototype.cpp:jsFunction_monitorEventLoopDelay": {
    functions: 1,
    sets: 324,
    returned: 75,
    taken: [0],
    refused: [],
  },
  "native:NewCppFunction:NodeModuleModule.cpp:jsFunctionIsModuleResolveFilenameSlowPathEnabled": {
    functions: 1,
    sets: 192,
    returned: 192,
    taken: [],
    refused: [],
  },
  "native:NewCppFunction:NodeTLS.cpp:loadExtraCACertificates": {
    functions: 1,
    sets: 192,
    returned: 192,
    taken: [],
    refused: [],
  },
  "native:NewCppFunction:NodeTLS.cpp:parseCACertificates": {
    functions: 1,
    sets: 316,
    returned: 5,
    taken: [0],
    refused: [],
  },
  "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsDeepStrictEqual": {
    functions: 1,
    sets: 1065,
    returned: 1065,
    taken: [0, 1],
    refused: [],
  },
  "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionPartialDeepStrictEqual": {
    functions: 1,
    sets: 360,
    returned: 360,
    taken: [0, 1],
    refused: [],
  },
  "native:NewCppFunction:decodeURIComponentSIMD.cpp:jsFunctionDecodeURIComponentSIMD": {
    functions: 1,
    sets: 192,
    returned: 192,
    taken: [0],
    refused: [],
  },
  "native:NewCppFunction:stringWidth.cpp:jsFunctionBunStringWidth": {
    functions: 1,
    sets: 342,
    returned: 340,
    taken: [0, 1],
    refused: [],
  },
};
