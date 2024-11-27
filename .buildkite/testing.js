const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const HOSTS = [
  { ip: "100.87.90.49" }, // darwin-aarch64-studio-1
  { ip: "100.97.76.100" }, // darwin-aarch64-studio-2
  { ip: "100.89.57.55" }, // darwin-x64-mini-2
  { ip: "100.124.249.44" }, // darwin-x64-mini-1
];

async function deployDaemon(host, retryCount = 0) {
  const cmd = `ssh -o StrictHostKeyChecking=accept-new root@${host.ip} 'cat > /Library/LaunchDaemons/com.buildkite.cache-cleanup.plist << EOL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
   <key>Label</key>
   <string>com.buildkite.cache-cleanup</string>
   <key>ProgramArguments</key>
   <array>
       <string>/bin/sh</string>
       <string>-c</string>
       <string>rm -rf /tmp/* /var/tmp/* /private/tmp/* /private/var/tmp/* /var/cache/* /usr/local/etc/buildkite-agent/cache/* /opt/homebrew/etc/buildkite-agent/cache/* /var/lib/buildkite-agent/cache/* /usr/local/lib/buildkite-agent/cache/* ~/Library/Caches/* ~/Library/Logs/*</string>
   </array>
   <key>RunAtLoad</key>
   <true/>
   <key>StartCalendarInterval</key>
   <dict>
       <key>Hour</key>
       <integer>5</integer>
       <key>Minute</key>
       <integer>0</integer>
   </dict>
   <key>StandardErrorPath</key>
   <string>/var/log/cache-cleanup.log</string>
   <key>StandardOutPath</key>
   <string>/var/log/cache-cleanup.log</string>
</dict>
</plist>
EOL
launchctl unload /Library/LaunchDaemons/com.buildkite.cache-cleanup.plist 2>/dev/null || true
launchctl load /Library/LaunchDaemons/com.buildkite.cache-cleanup.plist
launchctl start com.buildkite.cache-cleanup'`;

  try {
    const { stdout } = await execAsync(cmd);
    console.log(`✓ ${host.ip}\n${stdout}`);
  } catch (error) {
    if (retryCount < 3) {
      console.log(`× Retrying ${host.ip} (${retryCount + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return deployDaemon(host, retryCount + 1);
    }
    console.error(`× Failed ${host.ip}: ${error.message}`);
  }
}

async function main() {
  for (const host of HOSTS) {
    await deployDaemon(host);
  }
}

main();
