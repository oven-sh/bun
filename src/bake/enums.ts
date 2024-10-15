// TODO: generate this using information in DevServer.zig

export const enum MessageId {
  /// Version packet
  version = 86,
  /// When visualization mode is enabled, this packet contains
  /// the entire serialized IncrementalGraph state.
  visualizer = 118,
  /// Sent on a successful bundle, containing client code.
  hot_update = 40,
  /// Sent on a successful bundle, containing a list of
  /// routes that are updated.
  route_update = 82,
  /// Sent when the list of errors changes.
  errors = 69,
  /// Sent when all errors are cleared. Semi-redundant
  errors_cleared = 99,
}

export const enum BundlerMessageLevel {
  err = 0,
  warn = 1,
  note = 2,
  debug = 3,
  verbose = 4,
}
