import { define } from "../../codegen/class-definitions.ts";

function generate(ssl) {
  return define({
    name: !ssl ? "TCPSocket" : "TLSSocket",
    JSType: "0b11101110",
    noConstructor: true,
    configurable: false,
    memoryCost: true,
    // Visited slot holding the shared JSSocketHandlers cell, so the callbacks
    // stay alive as long as any socket that can still fire them. The duplex*
    // slots carry the origin stream and the four native listener thunks for a
    // TLSSocket driven by an upgraded Duplex (UpgradedDuplex); plain TCP
    // sockets never populate them.
    values: ssl
      ? ["handlers", "duplexOrigin", "duplexOnData", "duplexOnEnd", "duplexOnWritable", "duplexOnClose"]
      : ["handlers"],
    proto: {
      getAuthorizationError: {
        fn: "getAuthorizationError",
        returns: "Error | null",
        checkedAtRuntime: true,
        length: 0,
      },
      resume: {
        fn: "resumeFromJS",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      pause: {
        fn: "pauseFromJS",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      getTLSFinishedMessage: {
        fn: "getTLSFinishedMessage",
        returns: "Buffer | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      getTLSPeerFinishedMessage: {
        fn: "getTLSPeerFinishedMessage",
        returns: "Buffer | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      getEphemeralKeyInfo: {
        fn: "getEphemeralKeyInfo",
        returns: "object | null",
        checkedAtRuntime: true,
        length: 0,
      },
      getCipher: {
        fn: "getCipher",
        returns: "object | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      renegotiate: {
        fn: "renegotiate",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      disableRenegotiation: {
        fn: "disableRenegotiation",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      isSessionReused: {
        fn: "isSessionReused",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 0,
      },
      setVerifyMode: {
        fn: "setVerifyMode",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      getSession: {
        fn: "getSession",
        returns: "Buffer | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      setSession: {
        fn: "setSession",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      getTLSTicket: {
        fn: "getTLSTicket",
        returns: "Buffer | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      setKeyCert: {
        fn: "setKeyCert",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      exportKeyingMaterial: {
        fn: "exportKeyingMaterial",
        returns: "Buffer | undefined",
        checkedAtRuntime: true,
        length: 3,
      },
      setMaxSendFragment: {
        fn: "setMaxSendFragment",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      getSharedSigalgs: {
        fn: "getSharedSigalgs",
        returns: "Array | null | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      getTLSVersion: {
        fn: "getTLSVersion",
        returns: "string | null",
        checkedAtRuntime: true,
        length: 0,
      },
      getPeerCertificate: {
        fn: "getPeerCertificate",
        returns: "object | undefined | null",
        checkedAtRuntime: true,
        length: 1,
      },

      authorized: {
        getter: "getAuthorized",
        type: "boolean",
        pure: true,
      },
      alpnProtocol: {
        getter: "getALPNProtocol",
        type: "string | boolean",
        checkedAtRuntime: true,
      },
      bytesWritten: {
        getter: "getBytesWritten",
        type: "number",
        pure: true,
      },
      fd: {
        getter: "getFD",
        type: "number",
        checkedAtRuntime: true,
      },
      setNoDelay: {
        fn: "setNoDelay",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      setTypeOfService: {
        fn: "setTypeOfService",
        returns: "int32",
        checkedAtRuntime: true,
        length: 1,
      },
      getTypeOfService: {
        fn: "getTypeOfService",
        returns: "int32",
        checkedAtRuntime: true,
        length: 0,
      },
      resumeSNI: {
        fn: "resumeSNI",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      setKeepAlive: {
        fn: "setKeepAlive",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 2,
      },
      write: {
        fn: "write",
        returns: "int32",
        checkedAtRuntime: true,
        length: 3,
      },
      upgradeTLS: {
        fn: "upgradeTLS",
        returns: "Array | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      end: {
        fn: "end",
        returns: "number",
        checkedAtRuntime: true,
        length: 3,
      },
      terminate: {
        fn: "terminate",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      listener: {
        getter: "getListener",
        type: "Listener | undefined",
        checkedAtRuntime: true,
      },

      timeout: {
        fn: "timeout",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },

      flush: {
        fn: "flush",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      "@@dispose": {
        fn: "end",
        returns: "number",
        checkedAtRuntime: true,
        length: 0,
      },

      shutdown: {
        fn: "shutdown",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      close: {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      ref: {
        fn: "jsRef",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      unref: {
        fn: "jsUnref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      localFamily: {
        getter: "getLocalFamily",
        type: "string | undefined",
        cache: true,
      },
      localAddress: {
        getter: "getLocalAddress",
        type: "string | undefined",
        cache: true,
      },
      localPort: {
        getter: "getLocalPort",
        type: "int32 | undefined",
        cache: true,
      },

      data: {
        getter: "getData",
        cache: true,
        setter: "setData",
      },
      readyState: {
        getter: "getReadyState",
        type: "int32",
      },

      remoteFamily: {
        getter: "getRemoteFamily",
        type: "string | undefined",
        cache: true,
      },
      remoteAddress: {
        getter: "getRemoteAddress",
        type: "string | undefined",
        cache: true,
      },
      remotePort: {
        getter: "getRemotePort",
        type: "int32 | undefined",
      },

      reload: {
        fn: "reload",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      setServername: {
        fn: "setServername",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      getServername: {
        fn: "getServername",
        returns: "string | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      "writeBuffered": {
        fn: "writeBuffered",
        returns: "boolean | number",
        checkedAtRuntime: true,
        length: 2,
        privateSymbol: "write",
      },
      "endBuffered": {
        fn: "endBuffered",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 2,
        privateSymbol: "end",
      },
      getCertificate: {
        fn: "getCertificate",
        returns: "object | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      ...(ssl ? sslOnly : {}),
    },
    refCounted: true,
    construct: true,
    klass: {},
  });
}
const sslOnly = {
  getPeerX509Certificate: {
    fn: "getPeerX509Certificate",
    returns: "object | undefined",
    checkedAtRuntime: true,
    length: 0,
  },
  getX509Certificate: {
    fn: "getX509Certificate",
    returns: "object | undefined",
    checkedAtRuntime: true,
    length: 0,
  },
} as const;
export default [
  generate(true),
  generate(false),
  define({
    name: "Listener",
    types: [{ path: ["$Node", "ListenerHandle"], isView: false, typeArguments: [] }],
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    noConstructor: true,
    JSType: "0b11101110",
    // Visited slot holding the JSSocketHandlers cell shared with every socket
    // accepted by this listener.
    values: ["handlers"],
    proto: {
      stop: {
        fn: "stop",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      "@@dispose": {
        fn: "dispose",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },

      ref: {
        fn: "ref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      unref: {
        fn: "unref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      fd: {
        getter: "getFD",
        type: "number",
        checkedAtRuntime: true,
      },
      port: {
        getter: "getPort",
        type: "number | undefined",
        pure: true,
      },

      unix: {
        getter: "getUnix",
        type: "string | undefined",
        cache: true,
      },

      reload: {
        fn: "reload",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      hostname: {
        getter: "getHostname",
        type: "string | undefined",
        cache: true,
      },
      data: {
        getter: "getData",
        setter: "setData",
      },

      getsockname: {
        fn: "getsockname",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),

  define({
    name: "UDPSocket",
    types: [{ path: ["$Node", "UDPSocketHandle"], isView: false, typeArguments: [] }],
    noConstructor: true,
    JSType: "0b11101110",
    finalize: true,
    construct: true,
    sharedThis: true,
    values: ["on_data", "on_drain", "on_error"],
    proto: {
      send: {
        fn: "send",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 3,
      },
      sendMany: {
        fn: "sendMany",
        returns: "number",
        checkedAtRuntime: true,
        length: 3,
      },
      close: {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      "@@dispose": {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      reload: {
        fn: "reload",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      ref: {
        fn: "ref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      unref: {
        fn: "unref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      hostname: {
        getter: "getHostname",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      port: {
        getter: "getPort",
        type: "number | undefined",
        cache: true,
      },
      address: {
        getter: "getAddress",
        type: "object | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      remoteAddress: {
        getter: "getRemoteAddress",
        type: "object | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      binaryType: {
        getter: "getBinaryType",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      closed: {
        getter: "getClosed",
        type: "boolean",
        pure: true,
      },
      fd: {
        getter: "getFd",
        type: "number",
      },
      setBroadcast: {
        fn: "setBroadcast",
        length: 1,
      },
      setTTL: {
        fn: "setTTL",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      setMulticastTTL: {
        fn: "setMulticastTTL",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      setMulticastLoopback: {
        fn: "setMulticastLoopback",
        length: 1,
      },
      setMulticastInterface: {
        fn: "setMulticastInterface",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      addMembership: {
        fn: "addMembership",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 2,
      },
      dropMembership: {
        fn: "dropMembership",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 2,
      },
      addSourceSpecificMembership: {
        fn: "addSourceSpecificMembership",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 3,
      },
      dropSourceSpecificMembership: {
        fn: "dropSourceSpecificMembership",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 3,
      },
    },
    klass: {},
  }),
  define({
    name: "SocketAddress",
    types: [{ path: ["$Node", "SocketAddress"], isView: false, typeArguments: [] }],
    construct: true,
    call: false,
    finalize: true,
    estimatedSize: true,
    JSType: "0b11101110",
    klass: {
      parse: {
        fn: "parse",
        returns: "SocketAddress | undefined",
        checkedAtRuntime: true,
        length: 1,
        enumerable: false,
        configurable: true,
      },
      isSocketAddress: {
        fn: "isSocketAddress",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
        enumerable: false,
        configurable: true,
      },
    },
    proto: {
      address: {
        getter: "getAddress",
        type: "string",
        checkedAtRuntime: true,
        enumerable: false,
        configurable: true,
        cache: true,
      },
      port: {
        getter: "getPort",
        type: "int32",
        pure: true,
        enumerable: false,
        configurable: true,
      },
      family: {
        getter: "getFamily",
        type: "string",
        checkedAtRuntime: true,
        enumerable: false,
        configurable: true,
        cache: true,
      },
      addrfamily: {
        getter: "getAddrFamily",
        type: "int32",
        pure: true,
        enumerable: false,
        configurable: false,
      },
      flowlabel: {
        getter: "getFlowLabel",
        type: "number",
        pure: true,
        enumerable: false,
        configurable: true,
      },
      toJSON: {
        fn: "toJSON",
        returns: "object",
        checkedAtRuntime: true,
        length: 0,
        this: true,
        enumerable: false,
        configurable: true,
      },
    },
  }),
  define({
    name: "BlockList",
    types: [{ path: ["$Node", "BlockList"], isView: false, typeArguments: [] }],
    construct: true,
    call: false,
    refCounted: true,
    estimatedSize: true,
    // inspectCustom: true,
    structuredClone: { transferable: false, tag: 251, storable: false },
    JSType: "0b11101110",
    klass: {
      isBlockList: {
        fn: "isBlockList",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
    },
    proto: {
      addAddress: {
        fn: "addAddress",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      addRange: {
        fn: "addRange",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      addSubnet: {
        fn: "addSubnet",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      check: {
        fn: "check",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },
      rules: {
        getter: "rules",
        type: "Array",
        checkedAtRuntime: true,
      },
    },
  }),
];
