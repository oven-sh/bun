// Symbols used to hide various private properties and methods from the
// public API of the QUIC implementation.
// Ported from Node.js lib/internal/quic/symbols.js (v26.3.0).

const kInspect = Symbol.for("nodejs.util.inspect.custom");

const kAttachFileHandle = Symbol("kAttachFileHandle");
const kBlocked = Symbol("kBlocked");
const kConnect = Symbol("kConnect");
const kDrain = Symbol("kDrain");
const kDatagram = Symbol("kDatagram");
const kDatagramStatus = Symbol("kDatagramStatus");
const kEarlyDataRejected = Symbol("kEarlyDataRejected");
const kFinishClose = Symbol("kFinishClose");
const kGoaway = Symbol("kGoaway");
const kHandshake = Symbol("kHandshake");
const kHandshakeCompleted = Symbol("kHandshakeCompleted");
const kVerifyPeer = Symbol("kVerifyPeer");
const kHeaders = Symbol("kHeaders");
const kKeylog = Symbol("kKeylog");
const kListen = Symbol("kListen");
const kQlog = Symbol("kQlog");
const kNewSession = Symbol("kNewSession");
const kNewStream = Symbol("kNewStream");
const kNewToken = Symbol("kNewToken");
const kStreamCallbacks = Symbol("kStreamCallbacks");
const kStreamIdleTimeout = Symbol("kStreamIdleTimeout");
const kOrigin = Symbol("kOrigin");
const kOwner = Symbol("kOwner");
const kPathValidation = Symbol("kPathValidation");
const kPrivateConstructor = Symbol("kPrivateConstructor");
const kRemoveSession = Symbol("kRemoveSession");
const kRemoveStream = Symbol("kRemoveStream");
const kReset = Symbol("kReset");
const kSendHeaders = Symbol("kSendHeaders");
const kSessionTicket = Symbol("kSessionTicket");
const kTrailers = Symbol("kTrailers");
const kVersionNegotiation = Symbol("kVersionNegotiation");

export default {
  kAttachFileHandle,
  kBlocked,
  kConnect,
  kDatagram,
  kDatagramStatus,
  kDrain,
  kEarlyDataRejected,
  kFinishClose,
  kGoaway,
  kHandshake,
  kHandshakeCompleted,
  kVerifyPeer,
  kHeaders,
  kInspect,
  kKeylog,
  kListen,
  kNewSession,
  kNewStream,
  kNewToken,
  kStreamCallbacks,
  kStreamIdleTimeout,
  kOrigin,
  kOwner,
  kQlog,
  kPathValidation,
  kPrivateConstructor,
  kRemoveSession,
  kRemoveStream,
  kReset,
  kSendHeaders,
  kSessionTicket,
  kTrailers,
  kVersionNegotiation,
};
