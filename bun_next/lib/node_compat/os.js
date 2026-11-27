const osBinding = internalBinding('os');

module.exports = {
  hostname: () => osBinding.getHostname(),
  freemem: () => osBinding.getFreeMem() * 1024, // Node attend des bytes
  totalmem: () => osBinding.getTotalMem() * 1024,
  platform: () => process.platform,
  release: () => "v0.1.0",
  arch: () => "x64",
  type: () => "Windows_NT",
  uptime: () => 0,
  loadavg: () => [0, 0, 0],
  cpus: () => []
};
