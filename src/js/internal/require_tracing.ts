// Holds the "module.require" TracingChannel used by the CommonJS require path
// (builtins/CommonJS.ts). node:diagnostics_channel installs the channel here
// when it is first loaded, so a process that never loads diagnostics_channel
// never evaluates that module just to find out nobody subscribed.
export default {
  // TracingChannel for "module.require", set by node:diagnostics_channel.
  channel: undefined,
};
