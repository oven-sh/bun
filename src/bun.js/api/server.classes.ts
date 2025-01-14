import { define } from "../../codegen/class-definitions";

function generate(name) {
  return define({
    name,
    proto: {
      fetch: {
        fn: "doFetch",
        length: 1,
      },
      upgrade: {
        fn: "doUpgrade",
        length: 1,
      },
      publish: {
        fn: "doPublish",
        length: 3,
      },
      subscriberCount: {
        fn: "doSubscriberCount",
        length: 1,
      },
      reload: {
        fn: "doReload",
        length: 2,
      },
      "@@dispose": {
        fn: "dispose",
        length: 0,
      },
      stop: {
        fn: "doStop",
        length: 1,
      },
      requestIP: {
        fn: "doRequestIP",
        length: 1,
      },
      timeout: {
        fn: "doTimeout",
        length: 2,
      },
      port: {
        getter: "getPort",
      },
      id: {
        getter: "getId",
        cache: true,
      },
      pendingRequests: {
        getter: "getPendingRequests",
      },
      pendingWebSockets: {
        getter: "getPendingWebSockets",
      },
      ref: {
        fn: "doRef",
      },
      unref: {
        fn: "doUnref",
      },
      hostname: {
        getter: "getHostname",
        cache: true,
      },
      address: {
        getter: "getAddress",
        cache: true,
      },
      url: {
        getter: "getURL",
        cache: true,
      },
      protocol: {
        getter: "getProtocol",
      },
      development: {
        getter: "getDevelopment",
      },
    },
    klass: {},
    finalize: true,
    construct: true,
    noConstructor: true,
  });
}
export default [
  generate(`HTTPServer`),
  generate(`DebugHTTPServer`),
  generate(`HTTPSServer`),
  generate(`DebugHTTPSServer`),

  define({
    name: "ServerWebSocket",
    JSType: "0b11101110",
    memoryCost: true,
    proto: {
      send: {
        fn: "send",
        length: 2,
      },
      sendText: {
        fn: "sendText",
        length: 2,
        // ASSERTION FAILED: m_data[index].lockCount
        // /Users/jarred/actions-runner/_work/WebKit/WebKit/Source/JavaScriptCore/dfg/DFGRegisterBank.h(204) : void JSC::DFG::RegisterBank<JSC::GPRInfo>::unlock(RegID) [BankInfo = JSC::GPRInfo]
        // 1   0x102740124 WTFCrash
        // 3   0x103076bac JSC::MacroAssemblerARM64::add64(JSC::AbstractMacroAssembler<JSC::ARM64Assembler>::TrustedImm64, JSC::ARM64Registers::RegisterID, JSC::ARM64Registers::RegisterID)
        // 4   0x10309a2d0 JSC::DFG::SpeculativeJIT::compileCallDOM(JSC::DFG::Node*)::$_0::operator()(JSC::DFG::Edge) const
        // DOMJIT: {
        //   returns: "int",
        //   args: ["JSString", "bool"],
        // },
      },
      sendBinary: {
        fn: "sendBinary",
        length: 2,
        // ASSERTION FAILED: m_data[index].lockCount
        // /Users/jarred/actions-runner/_work/WebKit/WebKit/Source/JavaScriptCore/dfg/DFGRegisterBank.h(204) : void JSC::DFG::RegisterBank<JSC::GPRInfo>::unlock(RegID) [BankInfo = JSC::GPRInfo]
        // 1   0x102740124 WTFCrash
        // 3   0x103076bac JSC::MacroAssemblerARM64::add64(JSC::AbstractMacroAssembler<JSC::ARM64Assembler>::TrustedImm64, JSC::ARM64Registers::RegisterID, JSC::ARM64Registers::RegisterID)
        // 4   0x10309a2d0 JSC::DFG::SpeculativeJIT::compileCallDOM(JSC::DFG::Node*)::$_0::operator()(JSC::DFG::Edge) const
        // DOMJIT: {
        //   returns: "int",
        //   args: ["JSUint8Array", "bool"],
        // },
      },
      publishText: {
        fn: "publishText",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSString", "JSString"],
        },
      },
      publishBinary: {
        fn: "publishBinary",
        length: 2,
        DOMJIT: {
          returns: "int",
          args: ["JSString", "JSUint8Array"],
        },
      },
      ping: {
        fn: "ping",
        length: 1,
      },
      pong: {
        fn: "pong",
        length: 1,
      },
      close: {
        fn: "close",
        length: 3,
        passThis: true,
      },
      terminate: {
        fn: "terminate",
        length: 0,
        passThis: true,
      },
      cork: {
        fn: "cork",
        length: 1,
        passThis: true,
      },
      getBufferedAmount: {
        fn: "getBufferedAmount",
        length: 0,
      },
      binaryType: {
        getter: "getBinaryType",
        setter: "setBinaryType",
      },
      publish: {
        fn: "publish",
        length: 3,
      },
      data: {
        getter: "getData",
        cache: true,
        setter: "setData",
      },
      readyState: {
        getter: "getReadyState",
      },
      subscribe: {
        fn: "subscribe",
        length: 1,
      },
      unsubscribe: {
        fn: "unsubscribe",
        length: 1,
      },
      isSubscribed: {
        fn: "isSubscribed",
        length: 1,
      },
      remoteAddress: {
        getter: "getRemoteAddress",
        cache: true,
      },
    },
    finalize: true,
    construct: true,
    klass: {},
  }),
];
