import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { cpus, totalmem } from "os";

const getServerStats = createServerFn({
  method: "GET",
}).handler(async () => {
  const bunVersion = Bun.version;
  const bunRevision = Bun.revision;
  const cpuUsage = process.cpuUsage();
  const processUptime = process.uptime();

  // Calculate CPU usage percentage to avoid showing falsy cumulative values
  // CPU percentage = (total CPU time / (uptime * number of cores)) * 100
  const numCores = cpus().length;
  const totalCpuTime = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert microseconds to seconds
  const cpuPercentage = processUptime > 0 ? Math.min(100, (totalCpuTime / (processUptime * numCores)) * 100) : 0;

  const cpuInfo = cpus()[0];

  return {
    bunVersion,
    bunRevision,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptime: Math.floor(processUptime),
    cpu: {
      percentage: Math.round(cpuPercentage * 100) / 100,
      cores: numCores,
    },
    environment: {
      cpuModel: cpuInfo?.model || "Unknown",
      totalMemory: totalmem(),
    },
  };
});

export const Route = createFileRoute("/stats")({
  component: Stats,
  loader: async () => {
    const stats = await getServerStats();
    return { stats };
  },
});

function Stats() {
  const { stats } = Route.useLoaderData();

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatBytes = (bytes: number) => {
    const formatter = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });

    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) {
      return `${formatter.format(gb)} GB`;
    }
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
      return `${formatter.format(mb)} MB`;
    }
    const kb = bytes / 1024;
    return `${formatter.format(kb)} KB`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 antialiased">
      <div className="w-full max-w-md">
        <div className="relative bg-card/80 backdrop-blur-xl text-card-foreground rounded-2xl border border-border/50 shadow-2xl overflow-hidden h-[550px] max-h-4/5 grid grid-rows-[auto_1fr_auto]">
          <div className="px-8 py-6">
            <div className="space-y-2 text-center py-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Server Stats</h1>
              <p className="text-lg text-muted-foreground font-medium -mt-2">Runtime information</p>
            </div>
          </div>

          <div className="px-8 overflow-y-auto">
            <div className="space-y-4 pt-4 border-t border-border/30">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Bun Version</p>
                  <p className="text-foreground font-medium">{stats.bunVersion}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Revision</p>
                  <p className="text-foreground font-medium text-xs font-mono">{stats.bunRevision?.slice(0, 8)}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Platform</p>
                  <p className="text-foreground font-medium">{stats.platform}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Architecture</p>
                  <p className="text-foreground font-medium">{stats.arch}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Process ID</p>
                  <p className="text-foreground font-medium">{stats.pid}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Uptime</p>
                  <p className="text-foreground font-medium">{formatUptime(stats.uptime)}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">CPU Cores</p>
                  <p className="text-foreground font-medium">{stats.cpu.cores}</p>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">CPU Usage</p>
                  <p className="text-foreground font-medium">{stats.cpu.percentage}%</p>
                </div>
              </div>
              <div className="pt-4 border-t border-border/30">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1 text-center">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">CPU Model</p>
                    <p className="text-foreground font-medium text-xs">{stats.environment.cpuModel}</p>
                  </div>
                  <div className="space-y-1 text-center">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">Total Memory</p>
                    <p className="text-foreground font-medium">{formatBytes(stats.environment.totalMemory)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 pb-6">
            <div className="pt-6">
              <Link
                to="/"
                className="block w-full px-4 py-2 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity text-center text-sm"
              >
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
