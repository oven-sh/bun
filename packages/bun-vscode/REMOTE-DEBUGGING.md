# Remote Debugging with Bun VSCode Extension

This document explains how to use the remote debugging features of the Bun VSCode extension for debugging Bun applications in WSL, Docker containers, and SSH remote environments.

## Overview

The Bun VSCode extension now supports remote debugging scenarios including:

- **WSL (Windows Subsystem for Linux)**: Debug Bun applications running in WSL from Windows VSCode
- **Docker Containers**: Debug Bun applications running inside Docker containers  
- **SSH Remote**: Debug Bun applications running on remote servers via SSH

## Configuration

### Extension Settings

The extension provides several settings to control remote debugging behavior:

```json
{
  "bun.remote.enabled": true,                    // Enable remote debugging capabilities
  "bun.remote.autoDetectPaths": true,            // Auto-detect path mappings
  "bun.remote.defaultPort": 6499                 // Default debug port
}
```

### Launch Configuration Properties

Remote debugging configurations support the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `address` | string | TCP/IP address of remote debugger (default: "localhost") |
| `port` | number | Debug port to connect to (default: 6499) |
| `localRoot` | string | Path to local source code directory |
| `remoteRoot` | string | Path to remote source code directory |
| `skipFiles` | array | Glob patterns for files to skip during debugging |

## Setup Instructions

### WSL Debugging

1. **Start Bun with debugging enabled in WSL:**
   ```bash
   bun --inspect=0.0.0.0:6499 your-script.js
   ```

2. **Create a launch configuration in VSCode:**
   ```json
   {
     "type": "bun",
     "request": "attach",
     "name": "Attach to WSL",
     "address": "localhost",
     "port": 6499,
     "localRoot": "${workspaceFolder}",
     "remoteRoot": "/mnt/c/path/to/your/project"
   }
   ```

3. **Path mapping is automatic** when `bun.remote.autoDetectPaths` is enabled.

### Docker Container Debugging

1. **Dockerfile setup:**
   ```dockerfile
   FROM oven/bun:latest
   WORKDIR /workspace
   COPY . .
   EXPOSE 6499
   CMD ["bun", "--inspect=0.0.0.0:6499", "index.js"]
   ```

2. **Start container with port forwarding:**
   ```bash
   docker run -p 6499:6499 -v "$(pwd)":/workspace your-app
   ```

3. **Launch configuration:**
   ```json
   {
     "type": "bun",
     "request": "attach",
     "name": "Attach to Docker",
     "address": "localhost", 
     "port": 6499,
     "localRoot": "${workspaceFolder}",
     "remoteRoot": "/workspace"
   }
   ```

### SSH Remote Debugging

1. **Start Bun on remote server:**
   ```bash
   # On remote server
   bun --inspect=0.0.0.0:6499 your-script.js
   ```

2. **Set up SSH tunnel (optional but recommended):**
   ```bash
   # On local machine
   ssh -L 6499:localhost:6499 user@remote-server.com
   ```

3. **Launch configuration:**
   ```json
   {
     "type": "bun",
     "request": "attach", 
     "name": "Attach to SSH Remote",
     "address": "localhost",  // or remote-server.com if no tunnel
     "port": 6499,
     "localRoot": "${workspaceFolder}",
     "remoteRoot": "/home/user/project"
   }
   ```

## Example Launch Configurations

Here are complete launch configuration examples for common scenarios:

### WSL Configuration
```json
{
  "type": "bun",
  "request": "attach",
  "name": "[Remote] Attach to WSL",
  "address": "localhost",
  "port": 6499,
  "localRoot": "${workspaceFolder}",
  "remoteRoot": "/mnt/c/Users/username/project",
  "skipFiles": ["<node_internals>/**"]
}
```

### Docker Configuration
```json
{
  "type": "bun",
  "request": "attach",
  "name": "[Remote] Attach to Docker Container", 
  "address": "localhost",
  "port": 6499,
  "localRoot": "${workspaceFolder}",
  "remoteRoot": "/workspace",
  "skipFiles": ["<node_internals>/**"]
}
```

### SSH Remote Configuration
```json
{
  "type": "bun",
  "request": "attach",
  "name": "[Remote] Attach to SSH Remote",
  "address": "remote.server.com",
  "port": 6499, 
  "localRoot": "${workspaceFolder}",
  "remoteRoot": "/home/user/project",
  "skipFiles": ["<node_internals>/**"]
}
```

### Launch with Path Mapping
```json
{
  "type": "bun",
  "request": "launch",
  "name": "[Remote] Launch with Path Mapping",
  "program": "${file}",
  "cwd": "${workspaceFolder}",
  "localRoot": "${workspaceFolder}",
  "remoteRoot": "/workspace",
  "runtime": "bun",
  "env": {
    "NODE_ENV": "development"
  }
}
```

## Path Mapping

Path mapping is crucial for remote debugging to work correctly. The extension automatically maps file paths between your local development environment and the remote execution environment.

### Automatic Path Detection

When `bun.remote.autoDetectPaths` is enabled, the extension attempts to automatically detect appropriate path mappings:

- **WSL**: Converts Windows paths to `/mnt/` paths
- **Docker**: Maps to `/workspace` by default
- **SSH**: Preserves directory structure

### Manual Path Mapping

For complex scenarios, specify explicit path mappings:

```json
{
  "localRoot": "/Users/dev/my-project",
  "remoteRoot": "/app/source"
}
```

This maps:
- Local: `/Users/dev/my-project/src/index.ts`
- Remote: `/app/source/src/index.ts`

## Troubleshooting

### Common Issues

1. **Breakpoints not hitting:**
   - Verify path mapping is correct
   - Check that source maps are enabled
   - Ensure remote Bun process is running with `--inspect`

2. **Connection refused:**
   - Verify the debug port is open and accessible
   - Check firewall settings
   - Ensure port forwarding is set up correctly for Docker/SSH

3. **Source files not found:**
   - Review `localRoot` and `remoteRoot` settings
   - Enable `bun.remote.autoDetectPaths` for automatic detection
   - Use absolute paths in configuration

### Debug Information

Enable debug logging to troubleshoot issues:

```bash
# Set environment variables for detailed logging
BUN_DEBUG=1 bun --inspect=0.0.0.0:6499 your-script.js
```

## Security Considerations

- **Network binding**: Use `0.0.0.0` only in trusted environments
- **SSH tunneling**: Prefer SSH tunnels over direct remote connections
- **Firewall**: Restrict debug port access to trusted networks
- **Production**: Never enable debugging in production environments

## Advanced Usage

### Multiple Remote Targets

You can set up multiple remote debugging targets:

```json
{
  "configurations": [
    {
      "name": "Dev Container",
      "type": "bun",
      "request": "attach",
      "address": "localhost",
      "port": 6499,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/workspace"
    },
    {
      "name": "Staging Server", 
      "type": "bun",
      "request": "attach",
      "address": "staging.example.com",
      "port": 6499,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/opt/app"
    }
  ]
}
```

### Environment-Specific Settings

Use VSCode's environment-specific settings for different remote scenarios:

```json
{
  "bun.remote.enabled": true,
  "bun.remote.autoDetectPaths": true,
  "[wsl]": {
    "bun.remote.defaultPort": 6499
  },
  "[ssh-remote]": {
    "bun.remote.defaultPort": 9229
  }
}
```

## Getting Help

If you encounter issues with remote debugging:

1. Check the VSCode Output panel for error messages
2. Review the Debug Console for connection details  
3. Verify your launch configuration matches your remote setup
4. Report issues at: https://github.com/oven-sh/bun/issues