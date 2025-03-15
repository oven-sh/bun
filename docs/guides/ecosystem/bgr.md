# Run Bun as a daemon with BGR

[BGR](https://github.com/mements/bgr) is a lightweight process manager specifically optimized for Bun applications. It allows you to run your applications as daemons (background processes) with minimal configuration.

Using BGR as your process manager when deploying Bun applications offers several advantages:

- **Native Bun Support**: Built specifically for the Bun runtime environment
- **Lower Resource Usage**: Significantly lighter memory footprint than other process managers
- **Simple Configuration**: Zero-config defaults with intuitive command structure
- **Reliable Process Management**: Keeps your Bun application running continuously
- **Structured Logging**: Separate stdout and stderr logs for easier debugging

## Getting Started

### Installation

First, install BGR globally:

```bash
npm install -g bgr
```

Make sure you have Bun installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Running a Bun Application as a Daemon

To start your Bun application as a daemon process with BGR, use the following command:

```bash
bgr --name my-bun-app --directory ~/projects/my-bun-app --command "bun index.ts"
```

This command:
- Assigns a name to your process (`my-bun-app`)
- Sets the working directory for your application
- Specifies the command to run your Bun application

### Using Environment Variables

If your application requires environment variables, create a `.config.toml` file in your project directory:

```toml
[app]
port = 3000
host = "0.0.0.0"

[database]
url = "postgres://localhost:5432/mydb"
user = "admin"
```

BGR will automatically load this configuration and convert it to environment variables:

```
APP_PORT=3000
APP_HOST=0.0.0.0
DATABASE_URL=postgres://localhost:5432/mydb
DATABASE_USER=admin
```

### Managing Your Application

Once your application is running, you can:

**View all running processes:**
```bash
bgr
```

**Check status of a specific application:**
```bash
bgr my-bun-app
```

**Restart your application:**
```bash
bgr my-bun-app --restart
```

**Stop and delete your application:**
```bash
bgr --delete my-bun-app
```

## Ensuring High Availability with a Guard Script

For critical applications that need maximum uptime, you can use a guard script to automatically restart your application if it stops:

```bash
#!/usr/bin/env bun
// guard.ts
import { $, sleep } from "bun";

const processName = "my-bun-app";
const checkInterval = 30 * 1000; // 30 seconds

console.log(`🔍 Starting guard for process "${processName}"`);

while (true) {
  try {
    const result = await $`bgr ${processName}`.quiet().nothrow();
    
    if (result.stdout.includes("○ Stopped") || result.exitCode !== 0) {
      console.log(`⚠️ Process "${processName}" is not running! Restarting...`);
      await $`bgr ${processName} --restart --force`.nothrow();
    } else {
      console.log(`✅ Process "${processName}" is running`);
    }
  } catch (error) {
    console.error(`❌ Error checking process: ${error.message}`);
  }
  
  await sleep(checkInterval);
}
```

Run the guard script with:

```bash
bun guard.ts
```

You can also run the guard script itself with BGR to ensure both your application and the guard are running as daemons:

```bash
bgr --name guard-script --directory ~/projects/my-bun-app --command "bun guard.ts"
```

That's it! Your Bun application is now running as a daemon with BGR, with proper monitoring and automatic restarts.
