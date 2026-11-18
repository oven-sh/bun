import * as b from "../codegen/bindgen-lib.ts";
import { DesktopAppEvent } from "./desktop_base.bind.ts";
import { anything, js, noticesListeners, ownedTextIfAny, ownedTexts, returnsFlag } from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

export const ElectronIpcMain = b.interface("ElectronIpcMain", {
  ofModule: true,
  name: "IpcMain",
  rustPath: "crate::ipc::IpcMain",
  prototypeBase: "EventEmitter",
  inlineCapacity: 2,
  internalFields: ["handlers"],
  construct: { passStructure: true, ...js },
  proto: {
    _invokeHandlers: { getter: b.any, rustName: "invoke_handlers" },
    handle: { args: { channel: b.DOMString, handler: anything }, ...js },
    handleOnce: { args: { channel: b.DOMString, handler: anything }, ...js },
    removeHandler: { args: { channel: b.DOMString }, ...js },
  },
});

export const ElectronIpcEvent = b.interface("ElectronIpcEvent", {
  ofModule: true,
  name: "IpcMainEvent",
  extends: DesktopAppEvent,
  rustPath: "crate::ipc::IpcEvent",
  noInterfaceObject: true,
  internalFields: ["sender", "frame", "ports", "answer", "onAnswer"],
  proto: {
    type: { getter: b.string.utf8 },
    sender: { getter: b.any, field: "sender" },
    senderFrame: { getter: b.any, ...js },
    frameId: { getter: b.u32 },
    processId: { getter: b.u32 },
    ports: { getter: b.any, ...js },
    reply: { getter: b.any, ...js },
    returnValue: { getter: b.any, setter: js },
  },
});

export const ElectronMessagePortMain = b.interface("ElectronMessagePortMain", {
  ofModule: true,
  name: "MessagePortMain",
  rustPath: "crate::ports::MessagePortMain",
  prototypeBase: "EventEmitter",
  proto: { start: js, close: js, postMessage: { args: { message: anything, transfer: anything }, ...js } },
});

export const ElectronMessageChannelMain = b.interface("ElectronMessageChannelMain", {
  ofModule: true,
  name: "MessageChannelMain",
  rustPath: "crate::ports::MessageChannelMain",
  internalFields: ["port1", "port2"],
  construct: { passStructure: true, ...js },
  proto: { port1: { getter: b.any, field: "port1" }, port2: { getter: b.any, field: "port2" } },
});

export const ElectronPortCarrier = b.interface("ElectronPortCarrier", {
  ofModule: true,
  rustPath: "crate::ports::Carrier",
  noInterfaceObject: true,
  internalFields: ["send", "receive", "carried"],
});

export const ForkOptions = b.dictionary(
  {
    env: b.any.falsyAsNull,
    execArgv: ownedTexts.nullable,
    cwd: b.any,
    stdio: b.any.falsyAsNull,
    serviceName: ownedTextIfAny,
  },
  { fromJS: true },
);

export const ElectronUtilityProcess = b.interface("ElectronUtilityProcess", {
  ofModule: true,
  name: "UtilityProcess",
  rustPath: "crate::utility::UtilityProcess",
  prototypeBase: "EventEmitter",
  noInterfaceObject: true,
  internalFields: { child: b.any, carrier: ElectronPortCarrier },
  proto: {
    pid: { getter: b.any, ...js },
    stdout: { getter: b.any, ...js },
    stderr: { getter: b.any, ...js },
    postMessage: { args: { message: anything, transfer: anything }, ...js },
    kill: returnsFlag,
  },
});

export const ElectronUtilityProcesses = b.interface("ElectronUtilityProcesses", {
  ofModule: true,
  name: "UtilityProcesses",
  namespace: true,
  static: {
    fork: {
      args: { modulePath: ownedTextIfAny, args: anything, options: anything },
      returns: ElectronUtilityProcess,
      ...js,
    },
  },
});

export const ElectronParentPort = b.interface("ElectronParentPort", {
  ofModule: true,
  name: "ParentPort",
  namespace: true,
  prototypeBase: "EventEmitter",
  static: { ...noticesListeners, start: {}, pause: js, postMessage: { args: { message: anything }, ...js } },
});
